"""/api/profiles API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_constellation_api.py와 동일한 이유로 Firebase Auth 에뮬레이터 대신
app.dependency_overrides로 인증을 대체한다(이 스위트가 검증하려는 대상은
리포지토리/라우터 로직이지 토큰 검증 자체가 아니다).

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_profiles_api.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.firestore.client import get_firestore_client
from app.main import app


def _emulator_available() -> bool:
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        return False
    try:
        requests.get(f"http://{host}/", timeout=2)
    except requests.exceptions.RequestException:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _emulator_available(),
    reason=(
        "FIRESTORE_EMULATOR_HOST가 설정되지 않았거나 에뮬레이터가 응답하지 않음 - "
        "firebase emulators:exec --only firestore --project demo-ourlab 로 실행할 것"
    ),
)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    """app이 모듈 전역 싱글턴이라, 테스트가 실패하든 성공하든 override는 항상 지운다."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_as() -> Callable[[str], None]:
    """주어진 uid로 get_current_user/get_current_user_optional을 함께 override한다.

    profiles.py는 엔드포인트별로 둘 중 하나만 쓰지만(GET은 optional, 나머지는
    필수), 로그인 상태를 흉내낼 땐 둘 다 같은 uid를 돌려줘야 자연스럽다.
    """

    def _set(uid: str) -> None:
        # 연세대 인증 게이트(require_yonsei_verified) 도입 이후: 이 스위트의 대다수
        # 테스트는 "정상 인증 유저" 시나리오이므로 기본값을 True로 둔다. 미인증
        # 케이스는 test_follow_endpoints_require_yonsei_verification이 별도로 검증한다.
        # 프로필 수정(PATCH /me)은 게이트 대상이 아니므로(브리핑 - 자기 계정 설정은
        # "상호작용"이 아니다) get_current_user는 그대로 둔다.
        token = DecodedToken(uid=uid, yonsei_verified=True)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _set_user_doc(uid: str, data: dict) -> None:
    """리포지토리를 거치지 않고 raw Firestore 문서를 직접 세팅한다 (테스트 셋업 전용)."""
    get_firestore_client().collection("users").document(uid).set(data)


# --- GET /api/profiles/{uid} ---


@pytest.mark.asyncio
async def test_get_unknown_uid_returns_404() -> None:
    async with _client() as client:
        resp = await client.get("/api/profiles/no-such-uid")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_profile_anonymous_omits_is_following() -> None:
    _set_user_doc("user-a", {"display_name": "에이", "avatar_emoji": "🚀", "bio": "안녕"})
    async with _client() as client:
        resp = await client.get("/api/profiles/user-a")
    assert resp.status_code == 200
    data = resp.json()
    assert data["uid"] == "user-a"
    assert data["displayName"] == "에이"
    assert data["avatarEmoji"] == "🚀"
    assert data["bio"] == "안녕"
    assert data["followerCount"] == 0
    assert data["followingCount"] == 0
    assert "isFollowing" not in data


@pytest.mark.asyncio
async def test_get_own_profile_omits_is_following(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/profiles/user-a")
    assert resp.status_code == 200
    assert "isFollowing" not in resp.json()


# --- PATCH /api/profiles/me ---


@pytest.mark.asyncio
async def test_patch_me_requires_auth() -> None:
    async with _client() as client:
        resp = await client.patch("/api/profiles/me", json={"bio": "hi"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_patch_me_updates_bio(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.patch(
            "/api/profiles/me",
            json={"displayName": "새이름", "bio": "철학과 1학년입니다"},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["displayName"] == "새이름"
    assert data["bio"] == "철학과 1학년입니다"

    async with _client() as client:
        again = await client.get("/api/profiles/user-a")
    assert again.json()["bio"] == "철학과 1학년입니다"


@pytest.mark.asyncio
async def test_patch_me_with_none_fields_leaves_them_unchanged(
    authed_as: Callable[[str], None],
) -> None:
    _set_user_doc("user-a", {"display_name": "기존이름", "avatar_emoji": "🧭"})
    authed_as("user-a")
    async with _client() as client:
        resp = await client.patch("/api/profiles/me", json={"bio": "새 소개"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["displayName"] == "기존이름"
    assert data["avatarEmoji"] == "🧭"
    assert data["bio"] == "새 소개"


# --- 팔로우 / 언팔로우 ---


@pytest.mark.asyncio
async def test_follow_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/profiles/user-b/follow")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_follow_then_unfollow_updates_counts(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        follow_resp = await client.post("/api/profiles/user-b/follow")
        assert follow_resp.status_code == 200
        follow_data = follow_resp.json()
        assert follow_data["followerCount"] == 1
        assert follow_data["isFollowing"] is True

        me_resp = await client.get("/api/profiles/user-a")
        assert me_resp.json()["followingCount"] == 1

        unfollow_resp = await client.delete("/api/profiles/user-b/follow")
        assert unfollow_resp.status_code == 200
        unfollow_data = unfollow_resp.json()
        assert unfollow_data["followerCount"] == 0
        assert unfollow_data["isFollowing"] is False

        me_resp2 = await client.get("/api/profiles/user-a")
        assert me_resp2.json()["followingCount"] == 0


@pytest.mark.asyncio
async def test_duplicate_follow_is_noop(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        first = await client.post("/api/profiles/user-b/follow")
        second = await client.post("/api/profiles/user-b/follow")
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["followerCount"] == 1


@pytest.mark.asyncio
async def test_unfollow_without_following_is_noop(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        resp = await client.delete("/api/profiles/user-b/follow")
    assert resp.status_code == 200
    assert resp.json()["followerCount"] == 0


@pytest.mark.asyncio
async def test_self_follow_returns_400(authed_as: Callable[[str], None]) -> None:
    _set_user_doc("user-a", {})
    authed_as("user-a")

    async with _client() as client:
        resp = await client.post("/api/profiles/user-a/follow")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_is_following_true_when_viewer_follows_target(
    authed_as: Callable[[str], None],
) -> None:
    _set_user_doc("user-a", {})
    _set_user_doc("user-b", {})
    authed_as("user-a")

    async with _client() as client:
        await client.post("/api/profiles/user-b/follow")

    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/profiles/user-b")
    assert resp.json()["isFollowing"] is True


# --- 연세대 인증 게이트(require_yonsei_verified) ---


@pytest.mark.asyncio
async def test_follow_endpoints_require_yonsei_verification() -> None:
    """미인증(yonsei_verified=False) 유저는 팔로우/언팔로우가 403(헤더로 소유권 403과 구분)."""
    token = DecodedToken(uid="unverified-user", yonsei_verified=False)
    app.dependency_overrides[get_current_user] = lambda: token
    app.dependency_overrides[get_current_user_optional] = lambda: token
    async with _client() as client:
        follow_resp = await client.post("/api/profiles/user-b/follow")
        unfollow_resp = await client.delete("/api/profiles/user-b/follow")

    for resp in (follow_resp, unfollow_resp):
        assert resp.status_code == 403
        assert resp.headers["X-Auth-Requirement"] == "yonsei-verified"


@pytest.mark.asyncio
async def test_patch_me_does_not_require_yonsei_verification() -> None:
    """프로필 수정(PATCH /me)은 브리핑상 게이트 예외 - 미인증 유저도 이름/아바타를 정할 수 있어야 한다."""
    token = DecodedToken(uid="unverified-user", yonsei_verified=False)
    app.dependency_overrides[get_current_user] = lambda: token
    app.dependency_overrides[get_current_user_optional] = lambda: token
    async with _client() as client:
        resp = await client.patch("/api/profiles/me", json={"displayName": "미인증 유저"})
    assert resp.status_code == 200
    assert resp.json()["displayName"] == "미인증 유저"


# --- PATCH /api/profiles/me: 프로필 임베딩 재계산 ---


@pytest.mark.asyncio
async def test_patch_me_bio_change_creates_profile_embedding(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("embed-profile-user")
    async with _client() as client:
        resp = await client.patch(
            "/api/profiles/me", json={"bio": "철학과 1학년, 데이터 분야에 관심 있어요"}
        )
    assert resp.status_code == 200

    doc = get_firestore_client().collection("users").document("embed-profile-user").get().to_dict()
    assert doc is not None
    assert len(doc["profile_embedding"]) == 768


@pytest.mark.asyncio
async def test_patch_me_without_bio_does_not_call_embedder(
    authed_as: Callable[[str], None], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = []

    class _SpyEmbedder:
        async def embed(self, text: str, *, kind: str) -> list[float]:
            calls.append(text)
            return [0.0] * 768

    monkeypatch.setattr(
        "app.services.profile_embedding.get_embedding_client", lambda: _SpyEmbedder()
    )

    authed_as("embed-profile-user-2")
    async with _client() as client:
        resp = await client.patch("/api/profiles/me", json={"displayName": "이름만변경"})
    assert resp.status_code == 200
    assert calls == []


# --- POST /api/profiles/onboarding ---


def _onboarding_payload(**overrides: object) -> dict:
    payload: dict = {
        "studentId": "2024123456",
        "department": "철학과",
        "doubleMajor": None,
        "grade": 1,
        "declaredTags": ["데이터", "창업"],
        "careerText": "아직 진로를 정하지 못했습니다.",
        "consents": {"service": True, "overseas": True, "marketing": False},
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_onboarding_requires_auth() -> None:
    async with _client() as client:
        resp = await client.post("/api/profiles/onboarding", json=_onboarding_payload())
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_onboarding_routes_fields_to_three_destinations(
    authed_as: Callable[[str], None],
) -> None:
    """민감도별 3목적지 라우팅 - users/{uid}에 학과·학번·career_text가 새지 않는지 명시 검증."""
    authed_as("onboard-user-a")
    async with _client() as client:
        resp = await client.post("/api/profiles/onboarding", json=_onboarding_payload())
    assert resp.status_code == 200
    assert resp.json()["onboardingComplete"] is True

    db = get_firestore_client()

    # 1) users/{uid}: declared_tags만. 학과·학번·career_text·grade·복수전공은 절대 없어야 한다.
    user_doc = db.collection("users").document("onboard-user-a").get().to_dict()
    assert user_doc is not None
    assert user_doc.get("declared_tags") == ["데이터", "창업"]
    for leaked_field in ("department", "student_id", "career_text", "grade", "double_major"):
        assert leaked_field not in user_doc

    # 2) user_private/{uid}: 학과/학년/복수전공/career_text/동의시점.
    private_doc = db.collection("user_private").document("onboard-user-a").get().to_dict()
    assert private_doc is not None
    assert private_doc["department"] == "철학과"
    assert private_doc["grade"] == 1
    assert private_doc["career_text"] == "아직 진로를 정하지 못했습니다."
    assert private_doc.get("consent_service_at") is not None
    assert private_doc.get("consent_overseas_at") is not None
    assert "consent_marketing_at" not in private_doc  # marketing=False라 기록 안 됨
    assert "student_id" not in private_doc  # 학번 원문은 여기도 없다

    # 3) student_verifications/{uid}: 해시만, 학번 원문은 문서 어디에도 없다.
    verif_doc = db.collection("student_verifications").document("onboard-user-a").get().to_dict()
    assert verif_doc is not None
    assert "student_id_hmac" in verif_doc
    assert "2024123456" not in str(verif_doc.values())
    assert verif_doc["verified"] is False


@pytest.mark.asyncio
async def test_onboarding_requires_service_consent(authed_as: Callable[[str], None]) -> None:
    authed_as("onboard-user-b")
    async with _client() as client:
        resp = await client.post(
            "/api/profiles/onboarding",
            json=_onboarding_payload(consents={"service": False, "overseas": True}),
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_requires_overseas_consent(authed_as: Callable[[str], None]) -> None:
    authed_as("onboard-user-c")
    async with _client() as client:
        resp = await client.post(
            "/api/profiles/onboarding",
            json=_onboarding_payload(consents={"service": True, "overseas": False}),
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_rejects_empty_declared_tags(authed_as: Callable[[str], None]) -> None:
    authed_as("onboard-user-d")
    async with _client() as client:
        resp = await client.post(
            "/api/profiles/onboarding", json=_onboarding_payload(declaredTags=[])
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_rejects_eleven_declared_tags(authed_as: Callable[[str], None]) -> None:
    authed_as("onboard-user-e")
    async with _client() as client:
        resp = await client.post(
            "/api/profiles/onboarding",
            json=_onboarding_payload(declaredTags=[f"태그{i}" for i in range(11)]),
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_rejects_declared_tags_blank_after_trim(
    authed_as: Callable[[str], None],
) -> None:
    """스키마 단계(원시 개수 1개)는 통과하지만, 트림 후 실질 0개가 되는 경우 - 422여야 한다."""
    authed_as("onboard-user-f")
    async with _client() as client:
        resp = await client.post(
            "/api/profiles/onboarding", json=_onboarding_payload(declaredTags=["   "])
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_rejects_invalid_student_id_length(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("onboard-user-g")
    async with _client() as client:
        resp = await client.post(
            "/api/profiles/onboarding", json=_onboarding_payload(studentId="123456789")
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_trims_and_dedupes_declared_tags(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("onboard-user-h")
    async with _client() as client:
        resp = await client.post(
            "/api/profiles/onboarding",
            json=_onboarding_payload(declaredTags=["데이터", " 데이터 ", "창업"]),
        )
    assert resp.status_code == 200
    user_doc = get_firestore_client().collection("users").document("onboard-user-h").get().to_dict()
    assert user_doc["declared_tags"] == ["데이터", "창업"]
