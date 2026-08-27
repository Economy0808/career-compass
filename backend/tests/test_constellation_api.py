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
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user
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
    """

    def _set(uid: str) -> None:
        app.dependency_overrides[get_current_user] = lambda: DecodedToken(uid=uid)

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
