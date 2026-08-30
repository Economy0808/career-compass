"""DM(다이렉트 메시지) API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_posts_api.py/test_explore_api.py와 동일한 이유로 Mock을 쓰지 않는다(에뮬레이터
스킵 가드도 그 파일들을 그대로 복사한 관례). 인증은 app.dependency_overrides로
대체하고, require_yonsei_verified 뒤 엔드포인트라 authed_as는 yonsei_verified=True로
DecodedToken을 만든다(test_posts_api.py의 authed_as 관례와 동일 - 기본값 False라
그대로 두면 전부 403이 난다).
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.firestore import follow_repo
from app.firestore.client import get_firestore_client
from app.main import app


def _emulator_available() -> bool:
    """FIRESTORE_EMULATOR_HOST가 설정돼 있고 실제로 응답하는지 확인한다."""
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
    """주어진 uid로, yonsei_verified=True인 DecodedToken을 override한다.

    require_yonsei_verified 게이트 뒤 엔드포인트라(모듈 docstring 참고) 기본값
    False를 그대로 두면 전부 403이 난다.
    """

    def _set(uid: str) -> None:
        app.dependency_overrides[get_current_user] = lambda: DecodedToken(
            uid=uid, yonsei_verified=True
        )
        app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(
            uid=uid, yonsei_verified=True
        )

    return _set


def _anonymous() -> None:
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_optional, None)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ---------------------------------------------------------------------------
# 인증 게이트
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_threads_anonymous_401() -> None:
    _anonymous()
    async with _client() as client:
        resp = await client.get("/api/dm")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_send_message_requires_yonsei_verification(
    authed_as: Callable[[str], None],
) -> None:
    """yonsei_verified=False 유저는 403 + X-Auth-Requirement 헤더."""
    app.dependency_overrides[get_current_user] = lambda: DecodedToken(
        uid="dm-unverified", yonsei_verified=False
    )
    app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(
        uid="dm-unverified", yonsei_verified=False
    )
    async with _client() as client:
        resp = await client.post("/api/dm/dm-peer/messages", json={"body": "안녕"})
    assert resp.status_code == 403
    assert resp.headers.get("X-Auth-Requirement") == "yonsei-verified"


# ---------------------------------------------------------------------------
# 대화 자격 (팔로잉 OR 팔로워, 한쪽만 걸쳐도 가능)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_message_without_follow_relationship_403(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("dm-a-nofollow")
    async with _client() as client:
        resp = await client.post("/api/dm/dm-b-nofollow/messages", json={"body": "안녕하세요"})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_send_message_when_i_follow_peer_200(authed_as: Callable[[str], None]) -> None:
    db = get_firestore_client()
    follow_repo.follow(db, "dm-follower", "dm-followee")
    authed_as("dm-follower")
    async with _client() as client:
        resp = await client.post("/api/dm/dm-followee/messages", json={"body": "반가워요"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["senderUid"] == "dm-follower"
    assert body["body"] == "반가워요"


@pytest.mark.asyncio
async def test_send_message_when_peer_follows_me_200(authed_as: Callable[[str], None]) -> None:
    """핵심 계약: 상대가 나를 팔로우한 반대 방향도 200이어야 한다(맞팔 불필요)."""
    db = get_firestore_client()
    follow_repo.follow(db, "dm-reverse-follower", "dm-reverse-target")
    authed_as("dm-reverse-target")
    async with _client() as client:
        resp = await client.post(
            "/api/dm/dm-reverse-follower/messages", json={"body": "저를 팔로우하셨네요"}
        )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_send_message_to_self_blocked(authed_as: Callable[[str], None]) -> None:
    authed_as("dm-self")
    async with _client() as client:
        resp = await client.post("/api/dm/dm-self/messages", json={"body": "혼잣말"})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 대화방 수렴 + 참가자 검증 + 안읽음
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_same_pair_converges_to_same_thread_regardless_of_starter(
    authed_as: Callable[[str], None],
) -> None:
    db = get_firestore_client()
    follow_repo.follow(db, "dm-conv-a", "dm-conv-b")
    follow_repo.follow(db, "dm-conv-b", "dm-conv-a")  # 맞팔 - 양쪽 다 시작 가능하게

    authed_as("dm-conv-a")
    async with _client() as client:
        first = await client.post("/api/dm/dm-conv-b/messages", json={"body": "A가 먼저"})
    assert first.status_code == 201

    authed_as("dm-conv-b")
    async with _client() as client:
        second = await client.post("/api/dm/dm-conv-a/messages", json={"body": "B가 답장"})
        list_resp = await client.get("/api/dm")
    assert second.status_code == 201
    items = list_resp.json()["items"]
    thread_ids = {item["id"] for item in items if item["peer"]["uid"] == "dm-conv-a"}
    assert len(thread_ids) == 1  # 같은 쌍이 같은 방 하나로 수렴


@pytest.mark.asyncio
async def test_unread_increments_then_resets_on_read(
    authed_as: Callable[[str], None],
) -> None:
    db = get_firestore_client()
    follow_repo.follow(db, "dm-unread-sender", "dm-unread-recipient")
    authed_as("dm-unread-sender")
    async with _client() as client:
        await client.post("/api/dm/dm-unread-recipient/messages", json={"body": "읽어주세요"})

    authed_as("dm-unread-recipient")
    async with _client() as client:
        list_resp = await client.get("/api/dm")
        items = list_resp.json()["items"]
        entry = next(item for item in items if item["peer"]["uid"] == "dm-unread-sender")
        assert entry["unread"] == 1
        assert list_resp.json()["unreadTotal"] >= 1

        messages_resp = await client.get(f"/api/dm/{entry['id']}/messages")
        assert messages_resp.status_code == 200

        list_after_resp = await client.get("/api/dm")
        after_entry = next(
            item for item in list_after_resp.json()["items"] if item["id"] == entry["id"]
        )
        assert after_entry["unread"] == 0


@pytest.mark.asyncio
async def test_non_participant_cannot_read_thread_messages(
    authed_as: Callable[[str], None],
) -> None:
    db = get_firestore_client()
    follow_repo.follow(db, "dm-priv-a", "dm-priv-b")
    authed_as("dm-priv-a")
    async with _client() as client:
        send_resp = await client.post("/api/dm/dm-priv-b/messages", json={"body": "비밀 대화"})
    thread_id = None
    async with _client() as client:
        list_resp = await client.get("/api/dm")
        thread_id = next(
            item["id"] for item in list_resp.json()["items"] if item["peer"]["uid"] == "dm-priv-b"
        )

    authed_as("dm-priv-outsider")
    async with _client() as client:
        resp = await client.get(f"/api/dm/{thread_id}/messages")
    assert send_resp.status_code == 201
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /api/dm/partners - 새 대화 상대 목록 (팔로잉 ∪ 팔로워)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_partners_anonymous_401() -> None:
    _anonymous()
    async with _client() as client:
        resp = await client.get("/api/dm/partners")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_partners_requires_yonsei_verification() -> None:
    app.dependency_overrides[get_current_user] = lambda: DecodedToken(
        uid="dm-partners-unverified", yonsei_verified=False
    )
    app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(
        uid="dm-partners-unverified", yonsei_verified=False
    )
    async with _client() as client:
        resp = await client.get("/api/dm/partners")
    assert resp.status_code == 403
    assert resp.headers.get("X-Auth-Requirement") == "yonsei-verified"


@pytest.mark.asyncio
async def test_list_partners_route_not_shadowed_by_thread_messages_route(
    authed_as: Callable[[str], None],
) -> None:
    """/partners가 /{thread_id}/messages보다 먼저 선언돼야 한다 - test_posts_api.py의
    /feed vs /{post_id} 회귀 테스트와 동일한 함정 점검(모듈 docstring 참고)."""
    authed_as("dm-partners-route-order")
    async with _client() as client:
        resp = await client.get("/api/dm/partners")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_list_partners_includes_following_and_follower_union(
    authed_as: Callable[[str], None],
) -> None:
    """핵심 계약: 내가 팔로우한 사람과 나를 팔로우한 사람 둘 다 나와야 한다."""
    db = get_firestore_client()
    follow_repo.follow(db, "dm-partners-viewer", "dm-partners-following")
    follow_repo.follow(db, "dm-partners-follower", "dm-partners-viewer")

    authed_as("dm-partners-viewer")
    async with _client() as client:
        resp = await client.get("/api/dm/partners")

    assert resp.status_code == 200
    uids = {item["uid"] for item in resp.json()}
    assert "dm-partners-following" in uids
    assert "dm-partners-follower" in uids


@pytest.mark.asyncio
async def test_list_partners_deduplicates_mutual_follow(
    authed_as: Callable[[str], None],
) -> None:
    """맞팔(팔로잉이면서 팔로워인) 상대는 목록에 한 번만 나와야 한다."""
    db = get_firestore_client()
    follow_repo.follow(db, "dm-partners-mutual-viewer", "dm-partners-mutual-peer")
    follow_repo.follow(db, "dm-partners-mutual-peer", "dm-partners-mutual-viewer")

    authed_as("dm-partners-mutual-viewer")
    async with _client() as client:
        resp = await client.get("/api/dm/partners")

    uids = [item["uid"] for item in resp.json()]
    assert uids.count("dm-partners-mutual-peer") == 1


@pytest.mark.asyncio
async def test_list_partners_excludes_unrelated_and_self(
    authed_as: Callable[[str], None],
) -> None:
    db = get_firestore_client()
    follow_repo.follow(db, "dm-partners-excl-viewer", "dm-partners-excl-following")
    # dm-partners-excl-stranger는 아무 관계도 없다.

    authed_as("dm-partners-excl-viewer")
    async with _client() as client:
        resp = await client.get("/api/dm/partners")

    uids = {item["uid"] for item in resp.json()}
    assert "dm-partners-excl-stranger" not in uids
    assert "dm-partners-excl-viewer" not in uids


@pytest.mark.asyncio
async def test_list_partners_has_thread_reflects_existing_conversation(
    authed_as: Callable[[str], None],
) -> None:
    db = get_firestore_client()
    follow_repo.follow(db, "dm-partners-thread-viewer", "dm-partners-thread-with-msg")
    follow_repo.follow(db, "dm-partners-thread-viewer", "dm-partners-thread-without-msg")

    authed_as("dm-partners-thread-viewer")
    async with _client() as client:
        await client.post("/api/dm/dm-partners-thread-with-msg/messages", json={"body": "안녕"})
        resp = await client.get("/api/dm/partners")

    items = {item["uid"]: item for item in resp.json()}
    assert items["dm-partners-thread-with-msg"]["hasThread"] is True
    assert items["dm-partners-thread-without-msg"]["hasThread"] is False


@pytest.mark.asyncio
async def test_list_threads_sorted_by_latest_message(
    authed_as: Callable[[str], None],
) -> None:
    db = get_firestore_client()
    follow_repo.follow(db, "dm-sort-viewer", "dm-sort-old")
    follow_repo.follow(db, "dm-sort-viewer", "dm-sort-new")

    authed_as("dm-sort-viewer")
    async with _client() as client:
        await client.post("/api/dm/dm-sort-old/messages", json={"body": "먼저 보낸 메시지"})
        await client.post("/api/dm/dm-sort-new/messages", json={"body": "나중에 보낸 메시지"})
        list_resp = await client.get("/api/dm")

    peers = [item["peer"]["uid"] for item in list_resp.json()["items"]]
    assert peers.index("dm-sort-new") < peers.index("dm-sort-old")
