"""회원 탈퇴 + 비밀번호 재설정 테스트 (Mock 이메일, 네트워크 없음)."""

import re
from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.db import get_session_factory
from app.email.mock_sender import MockEmailSender
from app.main import app
from app.models.roadmap import (
    BeanTransaction,
    CareerGoal,
    Follow,
    Milestone,
    MilestonePost,
    PostComment,
    PostLike,
    Roadmap,
    User,
)
from tests.auth_utils import (
    TEST_PASSWORD,
    create_session_token,
    create_user,
    delete_user_cascade,
)


async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _last_code_for(email: str) -> str:
    for entry in reversed(MockEmailSender.outbox):
        if entry["to"] == email:
            m = re.search(r"\d{6}", entry["body"])
            assert m is not None
            return m.group()
    raise AssertionError(f"no mock email for {email}")


# ---------------- 비밀번호 재설정 ----------------


@pytest.mark.asyncio
async def test_password_reset_flow() -> None:
    session = await _get_session()
    user = await create_user(session)
    email = user.email or ""
    old_token = await create_session_token(session, user)
    try:
        async with _client() as client:
            resp = await client.post("/api/auth/password-reset/request", json={"email": email})
            assert resp.status_code == 200

            code = _last_code_for(email)
            resp = await client.post(
                "/api/auth/password-reset/confirm",
                json={"email": email, "code": code, "new_password": "brandnew123"},
            )
            assert resp.status_code == 200

            # 새 비밀번호로 로그인 성공, 옛 비밀번호 실패
            ok = await client.post(
                "/api/auth/login", json={"username": user.username, "password": "brandnew123"}
            )
            assert ok.status_code == 200
            bad = await client.post(
                "/api/auth/login", json={"username": user.username, "password": TEST_PASSWORD}
            )
            assert bad.status_code == 401

        # 재설정 후 기존 세션은 폐기됨
        async with _client() as client:
            client.cookies.set("cc_session", old_token)
            resp = await client.get("/api/auth/me")
            assert resp.status_code == 401
    finally:
        s = await _get_session()
        await delete_user_cascade(s, user.id)


@pytest.mark.asyncio
async def test_password_reset_unknown_email_is_generic() -> None:
    async with _client() as client:
        resp = await client.post(
            "/api/auth/password-reset/request", json={"email": "nobody-xyz@example.com"}
        )
        assert resp.status_code == 200  # 계정 존재 여부 노출 안 함


@pytest.mark.asyncio
async def test_password_reset_confirm_requires_valid_code() -> None:
    session = await _get_session()
    user = await create_user(session)
    try:
        async with _client() as client:
            await client.post("/api/auth/password-reset/request", json={"email": user.email})
            resp = await client.post(
                "/api/auth/password-reset/confirm",
                json={"email": user.email, "code": "000000", "new_password": "brandnew123"},
            )
            assert resp.status_code == 400
    finally:
        s = await _get_session()
        await delete_user_cascade(s, user.id)


# ---------------- 회원 탈퇴 ----------------


@pytest.fixture
async def deletable_user(tmp_path):
    """탈퇴 대상 유저 + 남(other)이 얽힌 데이터를 심는다."""
    session = await _get_session()
    owner = await create_user(session, display_name="탈퇴대상")
    other = await create_user(session, display_name="타인")
    owner_token = await create_session_token(session, owner)

    # 이미지 파일 (탈퇴 시 파기되어야 함)
    img = tmp_path / "post.jpg"
    img.write_bytes(b"\xff\xd8\xffimg")

    # owner의 대목표 → 로드맵/마일스톤/기록(+이미지)
    # 대목표를 붙여야 실제 plant 경로와 같은 모양이 된다 (career_goals.user_id FK).
    goal = CareerGoal(user_id=owner.id, title="내 대목표", context="탈퇴 테스트용 대목표")
    session.add(goal)
    await session.flush()
    roadmap = Roadmap(
        user_id=owner.id, title="내 로드맵", goal_raw_text="목표", career_goal_id=goal.id
    )
    session.add(roadmap)
    await session.flush()
    milestone = Milestone(
        roadmap_id=roadmap.id, order_index=0, title="m", description="d", due_date=date.today()
    )
    session.add(milestone)
    await session.flush()
    my_post = MilestonePost(milestone_id=milestone.id, caption="기록", image_path=str(img))
    session.add(my_post)
    await session.flush()

    # other의 로드맵/기록 (owner가 여기에 좋아요/댓글을 남긴다)
    o_roadmap = Roadmap(user_id=other.id, title="남 로드맵", goal_raw_text="목표")
    session.add(o_roadmap)
    await session.flush()
    o_ms = Milestone(
        roadmap_id=o_roadmap.id, order_index=0, title="m", description="d", due_date=date.today()
    )
    session.add(o_ms)
    await session.flush()
    o_post = MilestonePost(milestone_id=o_ms.id, caption="남 기록")
    session.add(o_post)
    await session.flush()

    session.add_all(
        [
            # 남이 내 글에 좋아요/댓글
            PostLike(post_id=my_post.id, user_id=other.id),
            PostComment(post_id=my_post.id, user_id=other.id, content="멋져요"),
            # 내가 남 글에 좋아요/댓글 (user_id FK — 안 지우면 탈퇴 막힘)
            PostLike(post_id=o_post.id, user_id=owner.id),
            PostComment(post_id=o_post.id, user_id=owner.id, content="응원해요"),
            # 팔로우 양방향
            Follow(follower_id=owner.id, followee_id=other.id),
            Follow(follower_id=other.id, followee_id=owner.id),
            # 콩 원장
            BeanTransaction(user_id=owner.id, amount=10, reason="roadmap_completed"),
        ]
    )
    await session.commit()

    yield {
        "owner": owner,
        "other": other,
        "owner_token": owner_token,
        "img": img,
        "o_post_id": o_post.id,
    }

    # other 정리 (owner는 테스트에서 삭제됨; 안 됐으면 정리)
    s = await _get_session()
    await delete_user_cascade(s, other.id)
    if await s.get(User, owner.id) is not None:
        await delete_user_cascade(s, owner.id)


@pytest.mark.asyncio
async def test_delete_account_hard_deletes_everything(deletable_user) -> None:
    d = deletable_user
    owner = d["owner"]
    async with _client() as client:
        client.cookies.set("cc_session", d["owner_token"])
        resp = await client.post("/api/auth/delete-account", json={"password": TEST_PASSWORD})
        assert resp.status_code == 204

    s = await _get_session()
    # 유저 + 내 데이터 전부 삭제
    assert await s.get(User, owner.id) is None
    assert (await s.scalars(select(Roadmap).where(Roadmap.user_id == owner.id))).first() is None
    assert (
        await s.scalars(select(CareerGoal).where(CareerGoal.user_id == owner.id))
    ).first() is None
    assert (
        await s.scalars(select(BeanTransaction).where(BeanTransaction.user_id == owner.id))
    ).first() is None
    # 내가 남 글에 남긴 좋아요/댓글도 삭제 (FK)
    assert (await s.scalars(select(PostLike).where(PostLike.user_id == owner.id))).first() is None
    assert (
        await s.scalars(select(PostComment).where(PostComment.user_id == owner.id))
    ).first() is None
    # 팔로우 양방향 삭제
    assert (
        await s.scalars(
            select(Follow).where(
                (Follow.follower_id == owner.id) | (Follow.followee_id == owner.id)
            )
        )
    ).first() is None
    # 이미지 파일 파기
    assert not d["img"].exists()
    # 타인의 글은 남아있다
    assert await s.get(MilestonePost, d["o_post_id"]) is not None


@pytest.mark.asyncio
async def test_delete_account_wrong_password(deletable_user) -> None:
    d = deletable_user
    async with _client() as client:
        client.cookies.set("cc_session", d["owner_token"])
        resp = await client.post("/api/auth/delete-account", json={"password": "wrongpass1"})
        assert resp.status_code == 401
    # 유저는 그대로
    s = await _get_session()
    assert await s.get(User, d["owner"].id) is not None


@pytest.mark.asyncio
async def test_delete_account_requires_login() -> None:
    async with _client() as client:
        resp = await client.post("/api/auth/delete-account", json={"password": TEST_PASSWORD})
        assert resp.status_code == 401
