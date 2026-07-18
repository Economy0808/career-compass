import pytest
from httpx import ASGITransport, AsyncClient

from app.db import get_session_factory
from app.llm.mock_client import (
    FIXED_QUESTIONS,
    FOLLOWUP_QUESTIONS,
    MAX_MILESTONES,
    MIN_MILESTONES,
)
from app.main import app
from tests.auth_utils import create_session_token, create_user, delete_user_cascade
from tests.roadmap_utils import plant_from_preview, plant_roadmap, preview_roadmap


async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def verified_user():
    session = await _get_session()
    user = await create_user(session, display_name="API테스트유저", avatar_emoji="🐸")
    token = await create_session_token(session, user)
    yield user, token
    await delete_user_cascade(session, user.id)


@pytest.fixture
async def other_verified_user():
    session = await _get_session()
    user = await create_user(session, display_name="다른유저", avatar_emoji="🦊")
    token = await create_session_token(session, user)
    yield user, token
    await delete_user_cascade(session, user.id)


async def _run_chat(client: AsyncClient, goal: str) -> tuple[list[dict], int]:
    """done까지 질답을 돌리고 (messages, 질문 수)를 돌려준다."""
    messages: list[dict] = []
    done = False
    question_count = 0
    while not done:
        resp = await client.post(
            "/api/roadmap/chat", json={"goal_raw_text": goal, "messages": messages}
        )
        assert resp.status_code == 200
        data = resp.json()
        done = data["done"]
        messages = data["messages"]
        if not done:
            question_count += 1
            assert data["question"] is not None
            messages.append({"role": "user", "content": "답변입니다"})
    return messages, question_count


@pytest.mark.asyncio
async def test_full_roadmap_flow(verified_user) -> None:
    _, token = verified_user
    async with _client() as client:
        client.cookies.set("cc_session", token)

        goal = "데이터 분석가가 되고 싶어"
        messages, question_count = await _run_chat(client, goal)
        assert question_count == len(FIXED_QUESTIONS)

        # 심기 전 미리보기: 저장 없이 브리핑 + 대목표 판단 + 마일스톤 전체가 온다
        preview = await preview_roadmap(client, goal, messages)
        assert preview["title"] == "데이터 분석가 로드맵"
        assert preview["briefing"]
        assert preview["career_goal"]["is_new"] is True
        assert preview["career_goal"]["title"]
        milestone_count = len(preview["milestones"])
        assert MIN_MILESTONES <= milestone_count <= MAX_MILESTONES  # 목표에 따라 가변
        # 프리뷰/상세 분리: 각 마일스톤에 detail 가이드가 채워진다
        assert all(m["detail"] for m in preview["milestones"])

        # 심기: 프리뷰 페이로드를 그대로 저장 (작성자는 세션에서 결정 - body에 user_id 없음)
        roadmap = await plant_from_preview(client, preview, goal, messages)
        assert roadmap["title"] == preview["title"]
        assert roadmap["progress_pct"] == 0.0
        assert roadmap["major_goal_title"] == preview["career_goal"]["title"]
        roadmap_id = roadmap["id"]

        resp = await client.get("/api/roadmap/feed")
        assert resp.status_code == 200
        assert any(card["id"] == roadmap_id for card in resp.json())

        resp = await client.get(f"/api/roadmap/{roadmap_id}")
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["progress_pct"] == 0.0
        assert detail["major_goal_title"] == preview["career_goal"]["title"]
        milestone_id = detail["milestones"][0]["id"]

        resp = await client.patch(
            f"/api/roadmap/milestones/{milestone_id}", json={"is_completed": True}
        )
        assert resp.status_code == 200
        patch_data = resp.json()
        assert patch_data["milestone"]["status"] == "완료"
        assert patch_data["roadmap_progress_pct"] == round(100 / milestone_count, 1)


@pytest.mark.asyncio
async def test_second_roadmap_reuses_major_goal(verified_user) -> None:
    """대목표 컨텍스트 재사용: 두 번째 유사 목표는 질문이 줄고 기존 대목표에 분류된다."""
    _, token = verified_user
    async with _client() as client:
        client.cookies.set("cc_session", token)

        first = await plant_roadmap(client, "퀀트가 되고 싶어")
        assert first["major_goal_title"] == "퀀트 되기"

        # 기존 대목표 컨텍스트가 주입되면 mock은 followup 질문만 낸다
        goal2 = "퀀트 공부를 위해 금융공학 스터디 하고 싶어"
        messages, question_count = await _run_chat(client, goal2)
        assert question_count == len(FOLLOWUP_QUESTIONS)

        preview = await preview_roadmap(client, goal2, messages)
        assert preview["career_goal"]["is_new"] is False
        assert preview["career_goal"]["title"] == "퀀트 되기"

        second = await plant_from_preview(client, preview, goal2, messages)
        assert second["major_goal_title"] == first["major_goal_title"]


@pytest.mark.asyncio
async def test_plant_validation(verified_user, other_verified_user) -> None:
    _, token = verified_user
    other_user, _ = other_verified_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        preview = await preview_roadmap(client, "검증 테스트 목표")

        # 마일스톤 개수 상한 초과 → 422
        too_many = {
            **preview,
            "milestones": preview["milestones"][:1] * 16,
            "goal_raw_text": "검증 테스트 목표",
            "messages": [],
        }
        resp = await client.post("/api/roadmap/plant", json=too_many)
        assert resp.status_code == 422

        # 타인 소유(존재하지 않는 것 포함) 대목표 id → 422
        stolen = {
            **preview,
            "career_goal": {**preview["career_goal"], "existing_id": 9999999},
            "goal_raw_text": "검증 테스트 목표",
            "messages": [],
        }
        resp = await client.post("/api/roadmap/plant", json=stolen)
        assert resp.status_code == 422


@pytest.mark.asyncio
async def test_feed_and_detail_are_public() -> None:
    async with _client() as client:
        resp = await client.get("/api/roadmap/feed")
        assert resp.status_code == 200
        resp = await client.get("/api/roadmap/9999999")
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_write_endpoints_require_auth() -> None:
    async with _client() as client:
        resp = await client.post(
            "/api/roadmap/preview", json={"goal_raw_text": "목표", "messages": []}
        )
        assert resp.status_code == 401
        resp = await client.patch("/api/roadmap/milestones/1", json={"is_completed": True})
        assert resp.status_code == 401
        resp = await client.post(
            "/api/roadmap/chat", json={"goal_raw_text": "목표", "messages": []}
        )
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_write_endpoints_require_yonsei_verification() -> None:
    session = await _get_session()
    user = await create_user(session, yonsei_verified=False)
    token = await create_session_token(session, user)
    try:
        async with _client() as client:
            client.cookies.set("cc_session", token)
            resp = await client.post(
                "/api/roadmap/preview", json={"goal_raw_text": "목표", "messages": []}
            )
            assert resp.status_code == 403
    finally:
        await delete_user_cascade(session, user.id)


@pytest.mark.asyncio
async def test_cannot_patch_others_milestone(verified_user, other_verified_user) -> None:
    _, owner_token = verified_user
    _, attacker_token = other_verified_user
    async with _client() as client:
        client.cookies.set("cc_session", owner_token)
        roadmap = await plant_roadmap(client, "내 목표")
        milestone_id = roadmap["milestones"][0]["id"]

    async with _client() as client:
        client.cookies.set("cc_session", attacker_token)
        resp = await client.patch(
            f"/api/roadmap/milestones/{milestone_id}", json={"is_completed": True}
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
async def test_patch_unknown_milestone_returns_404(verified_user) -> None:
    _, token = verified_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        resp = await client.patch("/api/roadmap/milestones/9999999", json={"is_completed": True})
        assert resp.status_code == 404
