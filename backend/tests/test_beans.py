from datetime import date, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update

from app.db import get_session_factory
from app.main import app
from app.models.roadmap import (
    BeanTransaction,
    Milestone,
    compute_withered,
)
from tests.auth_utils import create_session_token, create_user, delete_user_cascade
from tests.roadmap_utils import plant_roadmap


async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _plant(client: AsyncClient, goal: str) -> dict:
    return (await plant_roadmap(client, goal))[0]


async def _make_withered(roadmap_id: int) -> None:
    """마일스톤 마감일을 40일 전으로 돌려 시든 상태로 만든다 (유예 30일 초과)."""
    session = await _get_session()
    await session.execute(
        update(Milestone)
        .where(Milestone.roadmap_id == roadmap_id)
        .values(due_date=date.today() - timedelta(days=40))
    )
    await session.commit()


async def _complete_all(client: AsyncClient, roadmap: dict) -> dict:
    """모든 마일스톤을 완료 처리하고 마지막 patch 응답을 돌려준다."""
    last = {}
    for m in roadmap["milestones"]:
        resp = await client.patch(f"/api/roadmap/milestones/{m['id']}", json={"is_completed": True})
        assert resp.status_code == 200
        last = resp.json()
    return last


@pytest.fixture
async def bean_user():
    session = await _get_session()
    user = await create_user(session, display_name="콩테스트", avatar_emoji="🫘")
    token = await create_session_token(session, user)
    yield user, token
    await delete_user_cascade(session, user.id)


def _milestone_stub(due: date):
    class Stub:
        due_date = due
        is_completed_manual = False

        def compute_status(self, today=None):
            return "완료" if self.is_completed_manual else "기한초과"

    return Stub()


def test_compute_withered_boundaries() -> None:
    today = date.today()
    overdue_29 = [_milestone_stub(today - timedelta(days=29))]
    overdue_31 = [_milestone_stub(today - timedelta(days=31))]
    assert compute_withered(overdue_29, grace_days=30) is False  # 유예 내
    assert compute_withered(overdue_31, grace_days=30) is True  # 유예 초과
    done = _milestone_stub(today - timedelta(days=100))
    done.is_completed_manual = True
    assert compute_withered([done], grace_days=30) is False  # 완주하면 시들지 않음
    assert compute_withered([], grace_days=30) is False


@pytest.mark.asyncio
async def test_completion_awards_beans_once(bean_user) -> None:
    user, token = bean_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        roadmap = await _plant(client, "콩 보상 테스트 목표")
        n = len(roadmap["milestones"])

        last = await _complete_all(client, roadmap)
        assert last["beans_awarded"] == n * 2  # 마일스톤 수 x 2

        # 프로필 잔액 반영
        resp = await client.get(f"/api/users/{user.id}")
        assert resp.json()["bean_balance"] == n * 2

        # 완료 해제 후 재완료해도 중복 지급 없음
        milestone_id = roadmap["milestones"][0]["id"]
        resp = await client.patch(
            f"/api/roadmap/milestones/{milestone_id}", json={"is_completed": False}
        )
        assert resp.json()["beans_awarded"] is None
        resp = await client.patch(
            f"/api/roadmap/milestones/{milestone_id}", json={"is_completed": True}
        )
        assert resp.json()["beans_awarded"] is None
        resp = await client.get(f"/api/users/{user.id}")
        assert resp.json()["bean_balance"] == n * 2


@pytest.mark.asyncio
async def test_delete_requires_withered_and_beans(bean_user) -> None:
    user, token = bean_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        roadmap = await _plant(client, "시든 콩나무 삭제 테스트")

        # 멀쩡한 콩나무는 삭제 불가
        resp = await client.delete(f"/api/roadmap/{roadmap['id']}")
        assert resp.status_code == 409
        assert "시들지" in resp.json()["detail"]

        await _make_withered(roadmap["id"])
        resp = await client.get(f"/api/roadmap/{roadmap['id']}")
        assert resp.json()["is_withered"] is True

        # 콩 부족 (잔액 0)
        resp = await client.delete(f"/api/roadmap/{roadmap['id']}")
        assert resp.status_code == 409
        assert "부족" in resp.json()["detail"]

        # 콩 구매 (Mock 결제) 후 삭제 성공
        resp = await client.post("/api/beans/purchase", json={"package_id": "bean_10"})
        assert resp.status_code == 200
        purchase = resp.json()
        assert purchase["bean_balance"] == 10
        assert purchase["receipt_id"].startswith("mock-")

        resp = await client.delete(f"/api/roadmap/{roadmap['id']}")
        assert resp.status_code == 204
        resp = await client.get(f"/api/roadmap/{roadmap['id']}")
        assert resp.status_code == 404

        # 잔액 차감 + 삭제 내역에 제목 스냅샷 보존
        resp = await client.get(f"/api/users/{user.id}")
        assert resp.json()["bean_balance"] == 0

    session = await _get_session()
    tx = await session.scalar(
        select(BeanTransaction).where(
            BeanTransaction.user_id == user.id,
            BeanTransaction.reason == "roadmap_deleted",
        )
    )
    assert tx is not None and tx.amount == -10
    assert tx.roadmap_title == roadmap["title"]


@pytest.mark.asyncio
async def test_delete_forbidden_for_non_owner(bean_user) -> None:
    _, token = bean_user
    session = await _get_session()
    other = await create_user(session, display_name="타인", avatar_emoji="🙅")
    other_token = await create_session_token(session, other)
    try:
        async with _client() as client:
            client.cookies.set("cc_session", token)
            roadmap = await _plant(client, "남의 삭제 시도 대상")
        await _make_withered(roadmap["id"])
        async with _client() as client:
            client.cookies.set("cc_session", other_token)
            resp = await client.delete(f"/api/roadmap/{roadmap['id']}")
            assert resp.status_code == 403
    finally:
        await delete_user_cascade(session, other.id)


@pytest.mark.asyncio
async def test_deleting_last_subroadmap_removes_goal(bean_user) -> None:
    """마지막 소분류를 정리하면 고아 대목표도 함께 삭제된다."""
    user, token = bean_user
    async with _client() as client:
        client.cookies.set("cc_session", token)
        planted = await plant_roadmap(client, "고아 대목표 정리 테스트")
        resp = await client.get(f"/api/users/{user.id}/roadmaps")
        goal_id = resp.json()[0]["major_goal_id"]
        assert goal_id is not None

        for r in planted:
            await _make_withered(r["id"])
        resp = await client.post("/api/beans/purchase", json={"package_id": "bean_55"})
        assert resp.status_code == 200

        # 소분류가 남아 있는 동안엔 대목표 유지
        resp = await client.delete(f"/api/roadmap/{planted[0]['id']}")
        assert resp.status_code == 204
        assert (await client.get(f"/api/goals/{goal_id}")).status_code == 200

        # 마지막 소분류 삭제 → 대목표도 정리
        resp = await client.delete(f"/api/roadmap/{planted[1]['id']}")
        assert resp.status_code == 204
        assert (await client.get(f"/api/goals/{goal_id}")).status_code == 404


@pytest.mark.asyncio
async def test_ranking_counts_only_harvested_this_week(bean_user) -> None:
    user, token = bean_user
    session = await _get_session()
    buyer = await create_user(session, display_name="구매만한사람", avatar_emoji="💳")
    buyer_token = await create_session_token(session, buyer)
    try:
        # user: 완주로 수확
        async with _client() as client:
            client.cookies.set("cc_session", token)
            roadmap = await _plant(client, "랭킹 수확 테스트")
            await _complete_all(client, roadmap)
            n = len(roadmap["milestones"])

        # buyer: 구매만
        async with _client() as client:
            client.cookies.set("cc_session", buyer_token)
            resp = await client.post("/api/beans/purchase", json={"package_id": "bean_120"})
            assert resp.status_code == 200

        async with _client() as client:
            resp = await client.get("/api/beans/ranking")
            assert resp.status_code == 200
            ranking = resp.json()
            ids = [e["user"]["id"] for e in ranking]
            assert user.id in ids  # 수확한 유저는 랭킹에
            assert buyer.id not in ids  # 구매만 한 유저는 랭킹에 없음
            mine = next(e for e in ranking if e["user"]["id"] == user.id)
            assert mine["beans_earned"] == n * 2

        # 지난주 수확분은 이번 주 랭킹에서 빠진다
        await session.execute(
            update(BeanTransaction)
            .where(
                BeanTransaction.user_id == user.id,
                BeanTransaction.reason == "roadmap_completed",
            )
            .values(created_at=datetime.now() - timedelta(days=8))
        )
        await session.commit()
        async with _client() as client:
            resp = await client.get("/api/beans/ranking")
            ids = [e["user"]["id"] for e in resp.json()]
            assert user.id not in ids
    finally:
        await delete_user_cascade(session, buyer.id)


@pytest.mark.asyncio
async def test_purchase_requires_verified_login() -> None:
    async with _client() as client:
        resp = await client.post("/api/beans/purchase", json={"package_id": "bean_10"})
        assert resp.status_code == 401
