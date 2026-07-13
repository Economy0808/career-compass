from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.db import get_db
from app.models.roadmap import Milestone, Roadmap, User, compute_progress_pct


async def _make_session():
    async for session in get_db():
        return session


@pytest.mark.asyncio
async def test_create_roadmap_with_milestones() -> None:
    session = await _make_session()
    async with session:
        user = User(display_name="테스트유저", avatar_emoji="🦉")
        session.add(user)
        await session.flush()

        roadmap = Roadmap(
            user_id=user.id,
            title="데이터 분석가 되기",
            goal_raw_text="데이터 분석가가 되고 싶어",
            chat_transcript=[{"role": "assistant", "content": "왜 데이터 분석가가 되고 싶나요?"}],
        )
        roadmap.milestones = [
            Milestone(
                order_index=0,
                title="SQL 기초 학습",
                description="SQL 기초 문법 익히기",
                due_date=date.today() + timedelta(days=7),
            ),
            Milestone(
                order_index=1,
                title="포트폴리오 프로젝트",
                description="데이터 분석 프로젝트 1개 완성",
                due_date=date.today() + timedelta(days=30),
            ),
        ]
        session.add(roadmap)
        await session.commit()

        fetched = await session.scalar(select(Roadmap).where(Roadmap.id == roadmap.id))
        assert fetched is not None
        assert fetched.title == "데이터 분석가 되기"
        assert len(fetched.milestones) == 2
        assert fetched.milestones[0].order_index == 0
        assert fetched.chat_transcript[0]["content"] == "왜 데이터 분석가가 되고 싶나요?"

        await session.delete(fetched)
        await session.commit()

        remaining = await session.scalar(
            select(Milestone).where(Milestone.roadmap_id == roadmap.id)
        )
        assert remaining is None

        await session.delete(user)
        await session.commit()


def test_compute_status_manual_complete_overrides_overdue() -> None:
    milestone = Milestone(
        order_index=0,
        title="m",
        description="d",
        due_date=date.today() - timedelta(days=1),
        is_completed_manual=True,
    )
    assert milestone.compute_status() == "완료"


def test_compute_status_overdue() -> None:
    milestone = Milestone(
        order_index=0,
        title="m",
        description="d",
        due_date=date.today() - timedelta(days=1),
        is_completed_manual=False,
    )
    assert milestone.compute_status() == "기한초과"


def test_compute_status_in_progress() -> None:
    milestone = Milestone(
        order_index=0,
        title="m",
        description="d",
        due_date=date.today() + timedelta(days=1),
        is_completed_manual=False,
    )
    assert milestone.compute_status() == "진행중"


def test_compute_progress_pct_empty() -> None:
    assert compute_progress_pct([]) == 0.0


def test_compute_progress_pct_partial() -> None:
    milestones = [
        Milestone(
            order_index=0,
            title="a",
            description="d",
            due_date=date.today() + timedelta(days=1),
            is_completed_manual=True,
        ),
        Milestone(
            order_index=1,
            title="b",
            description="d",
            due_date=date.today() + timedelta(days=1),
            is_completed_manual=False,
        ),
    ]
    assert compute_progress_pct(milestones) == 50.0
