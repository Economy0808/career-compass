"""별자리(constellation) API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_note_repo.py / test_constellation_repo.py와 동일한 이유로 Mock을 쓰지 않는다
(에뮬레이터 스킵 가드도 그 파일들을 그대로 복사한 관례). 인증은 Firebase Auth
에뮬레이터를 띄우는 대신 app.dependency_overrides[get_current_user]로 대체한다 -
이 스위트가 검증하려는 대상은 "리포지토리 예외를 HTTP 상태코드로 옮기는 라우터
로직"이지 "Firebase ID 토큰 검증"(그건 test_firebase_auth.py의 몫) 자체가
아니기 때문이다.

app.main.app은 프로세스 전역 싱글턴이므로, dependency_overrides를 테스트마다
반드시 정리한다(_clear_overrides autouse 픽스처) - 정리를 빼먹으면 이 파일 밖의
다른 테스트까지 가짜 인증 상태로 오염된다.

실행 방법 (backend/ 에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_constellation_api.py -q"
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator

import pytest
import requests
from google.cloud import firestore
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
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
    """주어진 uid로 get_current_user override를 세팅하는 함수를 돌려준다.

    라우터가 실제로 import하는 app.auth.deps.get_current_user 객체를 그대로 키로
    써야 override가 먹는다 - app.core.deps의 동명 함수와 다른 객체이므로 헷갈리지
    않도록 여기서만 단일 진입점으로 wrapping한다.

    yonsei_verified을 항상 True로 만드는 이유: 쓰기 엔드포인트 전부가 이제
    require_yonsei_verified 게이트를 거친다(2026-08-30). DecodedToken 기본값(False)을
    그대로 쓰면 이 스위트의 쓰기 테스트 전부가 403으로 깨지므로, "이 유저는 이미
    인증됐다"를 기본 가정으로 삼는다. 시그니처는 그대로 유지한다 - 미인증 케이스는
    이 fixture를 쓰지 않고 dependency_overrides를 직접 건드려 표현한다(아래
    test_create_by_unverified_user_returns_403_with_auth_requirement_header 등 참고).
    """

    def _set(uid: str) -> None:
        token = DecodedToken(uid=uid, yonsei_verified=True)
        app.dependency_overrides[get_current_user] = lambda: token
        # 단건 GET처럼 optional 인증을 쓰는 라우트도 같은 uid로 보여야 한다
        # (test_community_api.py와 동일 패턴 - 하나만 override하면 익명으로 보임).
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _mark_published(constellation_id: str) -> None:
    """리포지토리를 거치지 않고 raw Firestore 문서를 직접 공개 처리한다 (테스트 셋업 전용)."""
    db = get_firestore_client()
    db.collection("constellations").document(constellation_id).update({"is_published": True})


# --- 인증 ---


@pytest.mark.asyncio
async def test_no_auth_header_returns_401() -> None:
    async with _client() as client:
        resp = await client.get("/api/constellations")
        assert resp.status_code == 401


def _set_unverified(uid: str) -> None:
    """authed_as와 달리 yonsei_verified=False 토큰을 강제하는 미인증 케이스 전용 헬퍼."""
    token = DecodedToken(uid=uid, yonsei_verified=False)
    app.dependency_overrides[get_current_user] = lambda: token
    app.dependency_overrides[get_current_user_optional] = lambda: token


@pytest.mark.asyncio
async def test_create_by_unverified_user_returns_403_with_auth_requirement_header() -> None:
    """미인증(연세대 인증 전) 유저는 별자리를 서버에 저장할 수 없다(2026-08-30 정책).

    프론트가 "로그인 필요"(401)와 "인증 유도 화면"(403 + 헤더)을 구분할 수 있어야
    하므로 헤더까지 함께 확인한다.
    """
    _set_unverified("unverified-user")
    async with _client() as client:
        resp = await client.post(
            "/api/constellations", json={"title": "미인증 시도", "goalRawText": "x"}
        )
        assert resp.status_code == 403
        assert resp.headers["X-Auth-Requirement"] == "yonsei-verified"


@pytest.mark.asyncio
async def test_publish_by_unverified_user_returns_403_with_auth_requirement_header(
    authed_as: Callable[[str], None],
) -> None:
    """발행(publish)도 저장에 준하는 쓰기 행동이므로 동일하게 막혀야 한다."""
    authed_as("owner-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "발행 시도", "goalRawText": "x"}
            )
        ).json()["id"]

    _set_unverified("owner-a")  # 같은 유저가 인증을 잃은 상황을 재현
    async with _client() as client:
        resp = await client.patch(f"/api/constellations/{cid}/publish", json={"isPublished": True})
        assert resp.status_code == 403
        assert resp.headers["X-Auth-Requirement"] == "yonsei-verified"


# --- 생성 / 조회 ---


@pytest.mark.asyncio
async def test_create_returns_server_id_and_camel_case(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellations",
            json={"title": "내 목표", "goalRawText": "철학과 진로 고민"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["ownerId"] == "user-a"
        assert data["title"] == "내 목표"
        assert data["goalRawText"] == "철학과 진로 고민"
        assert data["isPublished"] is False
        assert isinstance(data["id"], str) and data["id"]
        assert isinstance(data["createdAt"], int)
        assert isinstance(data["updatedAt"], int)


@pytest.mark.asyncio
async def test_create_with_initial_nodes_and_edges_round_trips(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellations",
            json={
                "title": "그래프 있는 목표",
                "goalRawText": "목표 원문",
                "nodes": [
                    {
                        "id": "element:phil-101",
                        "label": "철학개론",
                        "type": "course",
                        "position": {"x": 1.0, "y": 2.0},
                    },
                    {
                        "id": "n2",
                        "label": "두번째",
                        "type": "course",
                        "position": {"x": 3.0, "y": 4.0},
                    },
                ],
                "edges": [
                    {"id": "edge-local-1", "sourceNodeId": "element:phil-101", "targetNodeId": "n2"}
                ],
            },
        )
        assert resp.status_code == 201
        constellation_id = resp.json()["id"]

        resp = await client.get(f"/api/constellations/{constellation_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert set(data["nodes"].keys()) == {"element:phil-101", "n2"}
        assert set(data["edges"].keys()) == {"edge-local-1"}
        assert data["edges"]["edge-local-1"]["sourceNodeId"] == "element:phil-101"
        assert data["edges"]["edge-local-1"]["targetNodeId"] == "n2"
        # 노트가 없는 노드는 noteCount 키 자체가 없어야 한다.
        assert "noteCount" not in data["nodes"]["element:phil-101"]


@pytest.mark.asyncio
async def test_list_returns_only_my_constellations(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        await client.post("/api/constellations", json={"title": "A의 것", "goalRawText": "x"})

    authed_as("user-b")
    async with _client() as client:
        await client.post("/api/constellations", json={"title": "B의 것", "goalRawText": "y"})

    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/constellations")
        assert resp.status_code == 200
        titles = [c["title"] for c in resp.json()]
        assert titles == ["A의 것"]


@pytest.mark.asyncio
async def test_get_unpublished_by_other_user_returns_403(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        created = (
            await client.post("/api/constellations", json={"title": "비공개", "goalRawText": "x"})
        ).json()

    authed_as("user-b")
    async with _client() as client:
        resp = await client.get(f"/api/constellations/{created['id']}")
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_published_by_other_user_returns_200(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        created = (
            await client.post("/api/constellations", json={"title": "공개", "goalRawText": "x"})
        ).json()
    _mark_published(created["id"])

    authed_as("user-b")
    async with _client() as client:
        resp = await client.get(f"/api/constellations/{created['id']}")
        assert resp.status_code == 200
        assert resp.json()["title"] == "공개"


@pytest.mark.asyncio
async def test_get_unknown_id_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.get("/api/constellations/does-not-exist")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_by_non_owner_returns_403(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        created = (
            await client.post(
                "/api/constellations", json={"title": "삭제 대상", "goalRawText": "x"}
            )
        ).json()

    authed_as("user-b")
    async with _client() as client:
        resp = await client.delete(f"/api/constellations/{created['id']}")
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_by_owner_then_get_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        created = (
            await client.post(
                "/api/constellations", json={"title": "삭제될 것", "goalRawText": "x"}
            )
        ).json()
        resp = await client.delete(f"/api/constellations/{created['id']}")
        assert resp.status_code == 204
        resp = await client.get(f"/api/constellations/{created['id']}")
        assert resp.status_code == 404


# --- 노드/엣지 ---


@pytest.mark.asyncio
async def test_node_add_position_completion_flow(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "노드 흐름", "goalRawText": "x"}
            )
        ).json()["id"]

        resp = await client.post(
            f"/api/constellations/{cid}/nodes",
            json={
                "id": "element:phil-101",
                "label": "철학개론",
                "type": "course",
                "position": {"x": 0.0, "y": 0.0},
            },
        )
        assert resp.status_code == 201
        assert resp.json()["nodes"]["element:phil-101"]["label"] == "철학개론"

        resp = await client.patch(
            f"/api/constellations/{cid}/nodes/element:phil-101/position",
            json={"position": {"x": 10.0, "y": 20.0}},
        )
        assert resp.status_code == 200
        pos = resp.json()["nodes"]["element:phil-101"]["position"]
        assert pos == {"x": 10.0, "y": 20.0}

        resp = await client.patch(
            f"/api/constellations/{cid}/nodes/element:phil-101/completion",
            json={"isCompleted": True},
        )
        assert resp.status_code == 200
        assert resp.json()["nodes"]["element:phil-101"]["isCompleted"] is True


@pytest.mark.asyncio
async def test_node_color_saved_on_create_and_mutation_updates_it(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "색상 흐름", "goalRawText": "x"}
            )
        ).json()["id"]

        resp = await client.post(
            f"/api/constellations/{cid}/nodes",
            json={
                "id": "n1",
                "label": "n1",
                "type": "course",
                "position": {"x": 0, "y": 0},
                "color": "#FF00AA",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["nodes"]["n1"]["color"] == "#FF00AA"

        resp = await client.patch(
            f"/api/constellations/{cid}/nodes/n1/color",
            json={"color": "#00ff00"},
        )
        assert resp.status_code == 200
        assert resp.json()["nodes"]["n1"]["color"] == "#00ff00"


@pytest.mark.asyncio
async def test_node_color_invalid_pattern_returns_422(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "색상 검증", "goalRawText": "x"}
            )
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )

        resp = await client.patch(
            f"/api/constellations/{cid}/nodes/n1/color",
            json={"color": "red"},
        )
        assert resp.status_code == 422

        resp = await client.post(
            f"/api/constellations/{cid}/nodes",
            json={
                "id": "n2",
                "label": "n2",
                "type": "course",
                "position": {"x": 0, "y": 0},
                "color": "#fff",
            },
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_remove_unknown_node_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "노드 없음", "goalRawText": "x"}
            )
        ).json()["id"]
        resp = await client.delete(f"/api/constellations/{cid}/nodes/ghost")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_edge_add_remove_and_unknown_edge_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "엣지 흐름", "goalRawText": "x"}
            )
        ).json()["id"]
        for nid in ("n1", "n2"):
            await client.post(
                f"/api/constellations/{cid}/nodes",
                json={"id": nid, "label": nid, "type": "course", "position": {"x": 0, "y": 0}},
            )

        resp = await client.post(
            f"/api/constellations/{cid}/edges",
            json={"id": "e1", "sourceNodeId": "n1", "targetNodeId": "n2"},
        )
        assert resp.status_code == 201
        assert "e1" in resp.json()["edges"]

        resp = await client.delete(f"/api/constellations/{cid}/edges/e1")
        assert resp.status_code == 200
        assert "e1" not in resp.json()["edges"]

        resp = await client.delete(f"/api/constellations/{cid}/edges/ghost-edge")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_edge_color_saved_on_create_and_mutation_updates_it(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "엣지 색상 흐름", "goalRawText": "x"}
            )
        ).json()["id"]
        for nid in ("n1", "n2"):
            await client.post(
                f"/api/constellations/{cid}/nodes",
                json={"id": nid, "label": nid, "type": "course", "position": {"x": 0, "y": 0}},
            )

        resp = await client.post(
            f"/api/constellations/{cid}/edges",
            json={"id": "e1", "sourceNodeId": "n1", "targetNodeId": "n2", "color": "#FF00AA"},
        )
        assert resp.status_code == 201
        assert resp.json()["edges"]["e1"]["color"] == "#FF00AA"

        resp = await client.patch(
            f"/api/constellations/{cid}/edges/e1/color",
            json={"color": "#00ff00"},
        )
        assert resp.status_code == 200
        assert resp.json()["edges"]["e1"]["color"] == "#00ff00"

        # null은 커스텀 색을 지운다.
        resp = await client.patch(
            f"/api/constellations/{cid}/edges/e1/color",
            json={"color": None},
        )
        assert resp.status_code == 200
        assert "color" not in resp.json()["edges"]["e1"]


@pytest.mark.asyncio
async def test_edge_color_invalid_pattern_returns_422(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "엣지 색상 검증", "goalRawText": "x"}
            )
        ).json()["id"]
        for nid in ("n1", "n2"):
            await client.post(
                f"/api/constellations/{cid}/nodes",
                json={"id": nid, "label": nid, "type": "course", "position": {"x": 0, "y": 0}},
            )
        await client.post(
            f"/api/constellations/{cid}/edges",
            json={"id": "e1", "sourceNodeId": "n1", "targetNodeId": "n2"},
        )

        resp = await client.patch(
            f"/api/constellations/{cid}/edges/e1/color",
            json={"color": "red"},
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_node_glow_effect_saved_on_create_and_mutation_updates_it(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "글로우 흐름", "goalRawText": "x"}
            )
        ).json()["id"]

        resp = await client.post(
            f"/api/constellations/{cid}/nodes",
            json={
                "id": "n1",
                "label": "n1",
                "type": "course",
                "position": {"x": 0, "y": 0},
                "glowEffect": "supernova",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["nodes"]["n1"]["glowEffect"] == "supernova"

        resp = await client.patch(
            f"/api/constellations/{cid}/nodes/n1/glow",
            json={"glowEffect": "sparkle-2"},
        )
        assert resp.status_code == 200
        assert resp.json()["nodes"]["n1"]["glowEffect"] == "sparkle-2"

        # null은 기본 연출로 되돌린다.
        resp = await client.patch(
            f"/api/constellations/{cid}/nodes/n1/glow",
            json={"glowEffect": None},
        )
        assert resp.status_code == 200
        assert "glowEffect" not in resp.json()["nodes"]["n1"]


@pytest.mark.asyncio
async def test_node_glow_effect_invalid_pattern_returns_422(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "글로우 검증", "goalRawText": "x"}
            )
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )

        # 대문자로 시작 - 패턴 위반.
        resp = await client.patch(
            f"/api/constellations/{cid}/nodes/n1/glow",
            json={"glowEffect": "Supernova"},
        )
        assert resp.status_code == 422

        resp = await client.post(
            f"/api/constellations/{cid}/nodes",
            json={
                "id": "n2",
                "label": "n2",
                "type": "course",
                "position": {"x": 0, "y": 0},
                "glowEffect": "Bad_Slug",
            },
        )
        assert resp.status_code == 422


# --- 노트 ---


@pytest.mark.asyncio
async def test_notes_crud_round_trip(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "노트 흐름", "goalRawText": "x"}
            )
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )

        # 명시적 id로 생성
        resp = await client.post(
            f"/api/constellations/{cid}/notes",
            json={"id": "note-explicit", "nodeId": "n1", "title": "제목", "body": "본문"},
        )
        assert resp.status_code == 201
        note1 = resp.json()
        assert note1["id"] == "note-explicit"
        assert note1["nodeId"] == "n1"
        assert note1["isPublic"] is False

        # id 없이 생성 - 서버가 uuid4를 채워 반환해야 한다
        resp = await client.post(
            f"/api/constellations/{cid}/notes",
            json={"nodeId": "n1", "title": "두번째", "body": "본문2"},
        )
        assert resp.status_code == 201
        note2 = resp.json()
        assert isinstance(note2["id"], str) and note2["id"] != ""

        resp = await client.get(f"/api/constellations/{cid}/notes")
        assert resp.status_code == 200
        listed_ids = {n["id"] for n in resp.json()}
        assert listed_ids == {note1["id"], note2["id"]}

        resp = await client.patch(
            f"/api/constellations/{cid}/notes/{note1['id']}",
            json={"title": "수정됨", "body": "수정된 본문", "isPublic": True, "attachments": []},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "수정됨"
        assert resp.json()["isPublic"] is True

        resp = await client.delete(f"/api/constellations/{cid}/notes/{note1['id']}")
        assert resp.status_code == 204
        resp = await client.get(f"/api/constellations/{cid}/notes")
        assert {n["id"] for n in resp.json()} == {note2["id"]}


@pytest.mark.asyncio
async def test_empty_title_and_body_note_is_allowed(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "빈 노트", "goalRawText": "x"})
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )
        resp = await client.post(
            f"/api/constellations/{cid}/notes",
            json={"nodeId": "n1", "title": "", "body": ""},
        )
        assert resp.status_code == 201
        assert resp.json()["title"] == ""
        assert resp.json()["body"] == ""


@pytest.mark.asyncio
async def test_note_timestamps_are_epoch_ms_ints(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "시간", "goalRawText": "x"})
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )
        note = (await client.post(f"/api/constellations/{cid}/notes", json={"nodeId": "n1"})).json()
        assert isinstance(note["createdAt"], int)
        assert isinstance(note["updatedAt"], int)
        assert note["createdAt"] > 1_000_000_000_000
        assert note["updatedAt"] > 1_000_000_000_000

        cdata = (await client.get(f"/api/constellations/{cid}")).json()
        assert isinstance(cdata["createdAt"], int)
        assert isinstance(cdata["updatedAt"], int)
        assert cdata["createdAt"] > 1_000_000_000_000


@pytest.mark.asyncio
async def test_note_response_keys_are_camel_case(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "카멜", "goalRawText": "x"})
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )
        resp = await client.post(
            f"/api/constellations/{cid}/notes",
            json={
                "nodeId": "n1",
                "attachments": [
                    {
                        "id": "a1",
                        "name": "파일.pdf",
                        "mimeType": "application/pdf",
                        "url": "https://example.com/a1",
                    }
                ],
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "nodeId" in data
        assert "isPublic" in data
        assert data["attachments"][0]["mimeType"] == "application/pdf"


@pytest.mark.asyncio
async def test_node_note_count_omitted_when_zero_and_one_after_create(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "카운트", "goalRawText": "x"})
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )
        before = (await client.get(f"/api/constellations/{cid}")).json()
        assert "noteCount" not in before["nodes"]["n1"]

        await client.post(f"/api/constellations/{cid}/notes", json={"nodeId": "n1"})

        after = (await client.get(f"/api/constellations/{cid}")).json()
        assert after["nodes"]["n1"]["noteCount"] == 1


@pytest.mark.asyncio
async def test_note_with_javascript_url_attachment_is_rejected(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "위험 url", "goalRawText": "x"})
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )
        resp = await client.post(
            f"/api/constellations/{cid}/notes",
            json={
                "nodeId": "n1",
                "attachments": [
                    {
                        "id": "a1",
                        "name": "위험.html",
                        "mimeType": "text/html",
                        "url": "javascript:alert(1)",
                    }
                ],
            },
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_note_on_someone_elses_constellation_returns_403(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "남의 것", "goalRawText": "x"})
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/nodes",
            json={"id": "n1", "label": "n1", "type": "course", "position": {"x": 0, "y": 0}},
        )

    authed_as("user-b")
    async with _client() as client:
        resp = await client.post(f"/api/constellations/{cid}/notes", json={"nodeId": "n1"})
        assert resp.status_code == 403


# --- 보관함(bins) ---


@pytest.mark.asyncio
async def test_create_with_bins_returns_201_and_get_round_trips_camel_case(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.post(
            "/api/constellations",
            json={
                "title": "보관함 있는 목표",
                "goalRawText": "목표 원문",
                "bins": [
                    {
                        "id": "bin1",
                        "label": "군집 1",
                        "origin": "llm",
                        "advice": "이것부터 채워보세요",
                        "items": [
                            {
                                "id": "course:PHI1001",
                                "label": "철학개론",
                                "type": "course",
                                "subtitle": "3학점",
                            }
                        ],
                    }
                ],
            },
        )
        assert resp.status_code == 201
        cid = resp.json()["id"]
        assert resp.json()["bins"][0]["advice"] == "이것부터 채워보세요"

        resp = await client.get(f"/api/constellations/{cid}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["bins"]) == 1
        bin0 = data["bins"][0]
        assert bin0["id"] == "bin1"
        assert bin0["origin"] == "llm"
        assert bin0["advice"] == "이것부터 채워보세요"
        assert bin0["items"][0]["subtitle"] == "3학점"


@pytest.mark.asyncio
async def test_put_bins_replaces_old_bins(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations",
                json={
                    "title": "보관함 교체",
                    "goalRawText": "x",
                    "bins": [{"id": "old1", "label": "옛 군집", "origin": "user"}],
                },
            )
        ).json()["id"]

        resp = await client.put(
            f"/api/constellations/{cid}/bins",
            json={"bins": [{"id": "new1", "label": "새 군집", "origin": "llm", "items": []}]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert [b["id"] for b in data["bins"]] == ["new1"]

        resp = await client.get(f"/api/constellations/{cid}")
        assert [b["id"] for b in resp.json()["bins"]] == ["new1"]


@pytest.mark.asyncio
async def test_put_bins_by_non_owner_returns_403(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "남의 보관함", "goalRawText": "x"}
            )
        ).json()["id"]

    authed_as("user-b")
    async with _client() as client:
        resp = await client.put(
            f"/api/constellations/{cid}/bins",
            json={"bins": [{"id": "b1", "label": "b1", "origin": "user"}]},
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_put_bins_exceeding_cap_returns_422(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "보관함 상한", "goalRawText": "x"}
            )
        ).json()["id"]

        too_many_bins = [
            {"id": f"bin{i}", "label": f"군집{i}", "origin": "user"} for i in range(31)
        ]
        resp = await client.put(
            f"/api/constellations/{cid}/bins",
            json={"bins": too_many_bins},
        )
        assert resp.status_code == 422


# --- 성단(Group) ---


@pytest.mark.asyncio
async def test_create_group_returns_201_and_appears_in_get(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations",
                json={
                    "title": "성단 목표",
                    "goalRawText": "x",
                    "nodes": [
                        {
                            "id": "n1",
                            "label": "노드1",
                            "type": "course",
                            "position": {"x": 0, "y": 0},
                        },
                        {
                            "id": "n2",
                            "label": "노드2",
                            "type": "course",
                            "position": {"x": 1, "y": 1},
                        },
                    ],
                },
            )
        ).json()["id"]

        resp = await client.post(
            f"/api/constellations/{cid}/groups",
            json={
                "id": "g1",
                "label": "1학년 교양",
                "memberNodeIds": ["n1", "n2"],
                "position": {"x": 5.0, "y": 6.0},
            },
        )
        assert resp.status_code == 201
        group = resp.json()["groups"]["g1"]
        assert group["label"] == "1학년 교양"
        assert group["memberNodeIds"] == ["n1", "n2"]
        assert group["collapsed"] is True  # 기본값
        assert group["position"] == {"x": 5.0, "y": 6.0}

        resp = await client.get(f"/api/constellations/{cid}")
        assert resp.json()["groups"]["g1"]["label"] == "1학년 교양"


@pytest.mark.asyncio
async def test_create_group_silently_drops_unknown_member_node_ids(
    authed_as: Callable[[str], None],
) -> None:
    """존재하지 않는 node id는 422가 아니라 조용히 걸러져 저장된다."""
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations",
                json={
                    "title": "환각 방어",
                    "goalRawText": "x",
                    "nodes": [
                        {
                            "id": "n1",
                            "label": "노드1",
                            "type": "course",
                            "position": {"x": 0, "y": 0},
                        }
                    ],
                },
            )
        ).json()["id"]

        resp = await client.post(
            f"/api/constellations/{cid}/groups",
            json={
                "id": "g1",
                "label": "부분 존재",
                "memberNodeIds": ["n1", "no-such-node"],
                "position": {"x": 0.0, "y": 0.0},
            },
        )
        assert resp.status_code == 201
        assert resp.json()["groups"]["g1"]["memberNodeIds"] == ["n1"]


@pytest.mark.asyncio
async def test_patch_group_partial_update_only_touches_given_fields(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations",
                json={
                    "title": "부분 갱신",
                    "goalRawText": "x",
                    "nodes": [
                        {
                            "id": "n1",
                            "label": "노드1",
                            "type": "course",
                            "position": {"x": 0, "y": 0},
                        }
                    ],
                },
            )
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/groups",
            json={
                "id": "g1",
                "label": "원래 라벨",
                "memberNodeIds": ["n1"],
                "position": {"x": 0.0, "y": 0.0},
            },
        )

        resp = await client.patch(
            f"/api/constellations/{cid}/groups/g1",
            json={"collapsed": False},
        )
        assert resp.status_code == 200
        group = resp.json()["groups"]["g1"]
        assert group["collapsed"] is False
        assert group["label"] == "원래 라벨"  # 안 건드린 필드는 유지
        assert group["memberNodeIds"] == ["n1"]


@pytest.mark.asyncio
async def test_patch_unknown_group_returns_404(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "그룹 없음", "goalRawText": "x"}
            )
        ).json()["id"]
        resp = await client.patch(
            f"/api/constellations/{cid}/groups/no-such-group",
            json={"collapsed": False},
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_group_removes_group_but_keeps_member_nodes(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations",
                json={
                    "title": "그룹 해제",
                    "goalRawText": "x",
                    "nodes": [
                        {
                            "id": "n1",
                            "label": "노드1",
                            "type": "course",
                            "position": {"x": 0, "y": 0},
                        }
                    ],
                },
            )
        ).json()["id"]
        await client.post(
            f"/api/constellations/{cid}/groups",
            json={
                "id": "g1",
                "label": "해제될 그룹",
                "memberNodeIds": ["n1"],
                "position": {"x": 0.0, "y": 0.0},
            },
        )

        resp = await client.delete(f"/api/constellations/{cid}/groups/g1")
        assert resp.status_code == 200
        data = resp.json()
        assert "g1" not in data["groups"]
        assert "n1" in data["nodes"]  # 멤버 노드는 살아남는다


@pytest.mark.asyncio
async def test_group_mutation_by_non_owner_returns_403(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "남의 그룹", "goalRawText": "x"}
            )
        ).json()["id"]

    authed_as("user-b")
    async with _client() as client:
        resp = await client.post(
            f"/api/constellations/{cid}/groups",
            json={
                "id": "g1",
                "label": "침입",
                "memberNodeIds": [],
                "position": {"x": 0.0, "y": 0.0},
            },
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_constellation_without_groups_field_backfills_empty_dict(
    authed_as: Callable[[str], None],
) -> None:
    """groups 필드 자체가 없는 구 문서(역호환) - Pydantic 기본값으로 빈 dict가 채워져야 한다."""
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "구 문서", "goalRawText": "x"})
        ).json()["id"]

        db = get_firestore_client()
        db.collection("constellations").document(cid).update({"groups": firestore.DELETE_FIELD})

        resp = await client.get(f"/api/constellations/{cid}")
        assert resp.status_code == 200
        assert resp.json()["groups"] == {}


# --- 공개 / 비공개 ---


@pytest.mark.asyncio
async def test_publish_by_owner_returns_200_with_is_published_true(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "공개 전", "goalRawText": "x"})
        ).json()["id"]

        resp = await client.patch(f"/api/constellations/{cid}/publish", json={"isPublished": True})
        assert resp.status_code == 200
        data = resp.json()
        assert data["isPublished"] is True


@pytest.mark.asyncio
async def test_publish_with_meta_sets_description_and_contributors(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "메타 발행", "goalRawText": "x"}
            )
        ).json()["id"]

        resp = await client.patch(
            f"/api/constellations/{cid}/publish",
            json={
                "isPublished": True,
                "title": "새 제목",
                "description": "이 별자리는 이런 목표를 위한 것입니다.",
                "contributors": ["철수", "영희"],
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["isPublished"] is True
        assert data["title"] == "새 제목"
        assert data["description"] == "이 별자리는 이런 목표를 위한 것입니다."
        assert data["contributors"] == ["철수", "영희"]


@pytest.mark.asyncio
async def test_publish_without_meta_fields_keeps_existing_values(
    authed_as: Callable[[str], None],
) -> None:
    """title/description/contributors를 안 보내면(None) 기존 값을 그대로 유지해야 한다."""
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "원래 제목", "goalRawText": "x"}
            )
        ).json()["id"]
        await client.patch(
            f"/api/constellations/{cid}/publish",
            json={"isPublished": True, "description": "첫 설명", "contributors": ["철수"]},
        )

        # isPublished만 다시 보냄 - 나머지 필드는 유지되어야 한다.
        resp = await client.patch(f"/api/constellations/{cid}/publish", json={"isPublished": True})
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "원래 제목"
        assert data["description"] == "첫 설명"
        assert data["contributors"] == ["철수"]


@pytest.mark.asyncio
async def test_publish_contributor_too_long_returns_422(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "긴 이름", "goalRawText": "x"})
        ).json()["id"]

        resp = await client.patch(
            f"/api/constellations/{cid}/publish",
            json={"isPublished": True, "contributors": ["가" * 41]},
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_publish_too_many_contributors_returns_422(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "너무 많음", "goalRawText": "x"}
            )
        ).json()["id"]

        resp = await client.patch(
            f"/api/constellations/{cid}/publish",
            json={"isPublished": True, "contributors": [f"c{i}" for i in range(11)]},
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_publish_by_non_owner_returns_403(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post("/api/constellations", json={"title": "남의 것", "goalRawText": "x"})
        ).json()["id"]

    authed_as("user-b")
    async with _client() as client:
        resp = await client.patch(f"/api/constellations/{cid}/publish", json={"isPublished": True})
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_publish_unknown_id_returns_404(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        resp = await client.patch(
            "/api/constellations/no-such-id/publish", json={"isPublished": True}
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_after_publish_other_user_can_get(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "공개될 것", "goalRawText": "x"}
            )
        ).json()["id"]

        await client.patch(f"/api/constellations/{cid}/publish", json={"isPublished": True})

    authed_as("user-b")
    async with _client() as client:
        resp = await client.get(f"/api/constellations/{cid}")
        assert resp.status_code == 200
        assert resp.json()["isPublished"] is True
        assert resp.json()["title"] == "공개될 것"


@pytest.mark.asyncio
async def test_get_single_allows_anonymous_for_published(
    authed_as: Callable[[str], None],
) -> None:
    """발행된 별자리 단건 GET은 익명도 200 - 공유 링크/게시물 상세 임베드가 의존하는
    계약. (회귀: 단건만 하드 인증을 요구해 익명 401을 냈던 사고, 2026-08-30)"""
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "익명 단건 대상", "goalRawText": "x"}
            )
        ).json()["id"]
        await client.patch(f"/api/constellations/{cid}/publish", json={"isPublished": True})

    app.dependency_overrides.clear()  # 익명 상태 재현
    async with _client() as client:
        resp = await client.get(f"/api/constellations/{cid}")
        assert resp.status_code == 200
        assert resp.json()["isPublished"] is True


@pytest.mark.asyncio
async def test_get_single_denies_anonymous_for_unpublished(
    authed_as: Callable[[str], None],
) -> None:
    """미발행 별자리 단건 GET은 익명에게 403 - 완화가 비공개까지 열지 않는지 확인."""
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "비공개 단건", "goalRawText": "x"}
            )
        ).json()["id"]

    app.dependency_overrides.clear()
    async with _client() as client:
        resp = await client.get(f"/api/constellations/{cid}")
        assert resp.status_code == 403


# --- 유저 갤러리 (프로필 화면용 발행 목록) ---


@pytest.mark.asyncio
async def test_user_gallery_returns_only_published_for_that_uid(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("user-a")
    async with _client() as client:
        published = (
            await client.post("/api/constellations", json={"title": "발행됨", "goalRawText": "x"})
        ).json()["id"]
        unpublished = (
            await client.post("/api/constellations", json={"title": "미발행", "goalRawText": "x"})
        ).json()["id"]
        await client.patch(f"/api/constellations/{published}/publish", json={"isPublished": True})

    authed_as("user-b")
    async with _client() as client:
        other_published = (
            await client.post(
                "/api/constellations", json={"title": "다른 유저 발행", "goalRawText": "x"}
            )
        ).json()["id"]
        await client.patch(
            f"/api/constellations/{other_published}/publish", json={"isPublished": True}
        )

    async with _client() as client:
        resp = await client.get("/api/constellations/user/user-a")
        assert resp.status_code == 200
        ids = {c["id"] for c in resp.json()}
        assert published in ids
        assert unpublished not in ids
        assert other_published not in ids


@pytest.mark.asyncio
async def test_user_gallery_allows_anonymous_access(authed_as: Callable[[str], None]) -> None:
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "익명 갤러리", "goalRawText": "x"}
            )
        ).json()["id"]
        await client.patch(f"/api/constellations/{cid}/publish", json={"isPublished": True})

    app.dependency_overrides.clear()
    async with _client() as client:
        resp = await client.get("/api/constellations/user/user-a")
        assert resp.status_code == 200
        assert cid in {c["id"] for c in resp.json()}


@pytest.mark.asyncio
async def test_user_gallery_route_does_not_shadow_constellation_id_route(
    authed_as: Callable[[str], None],
) -> None:
    """/user/{uid}가 /{constellation_id}보다 먼저 매칭되어야 한다 - constellation_id로
    실제 문서 id를 넣었을 때 "user" 갤러리 라우트와 충돌 없이 정상 조회되어야 한다."""
    authed_as("user-a")
    async with _client() as client:
        cid = (
            await client.post(
                "/api/constellations", json={"title": "라우트 충돌 확인", "goalRawText": "x"}
            )
        ).json()["id"]

        resp = await client.get(f"/api/constellations/{cid}")
        assert resp.status_code == 200
        assert resp.json()["id"] == cid

        resp = await client.get("/api/constellations/user/user-a")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)
