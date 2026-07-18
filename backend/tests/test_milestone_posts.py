import io
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.db import get_session_factory
from app.main import app
from tests.auth_utils import create_session_token, create_user, delete_user_cascade
from tests.roadmap_utils import plant_roadmap


def _png_bytes(width: int = 1600, height: int = 900) -> bytes:
    """리사이즈 검증용 큰 PNG 생성."""
    img = Image.new("RGB", (width, height), (40, 120, 60))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def _get_session():
    return get_session_factory()()


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _plant_roadmap(client: AsyncClient) -> dict:
    return await plant_roadmap(client, "기록 테스트 목표")


@pytest.fixture
async def owner_and_viewer():
    session = await _get_session()
    owner = await create_user(session, display_name="기록주인", avatar_emoji="🖊️")
    viewer = await create_user(session, display_name="구경꾼", avatar_emoji="👀")
    owner_token = await create_session_token(session, owner)
    viewer_token = await create_session_token(session, viewer)
    yield owner, viewer, owner_token, viewer_token
    await delete_user_cascade(session, owner.id)
    await delete_user_cascade(session, viewer.id)


@pytest.mark.asyncio
async def test_post_crud_with_image_resize(owner_and_viewer) -> None:
    _, _, owner_token, _ = owner_and_viewer
    async with _client() as client:
        client.cookies.set("cc_session", owner_token)
        roadmap = await _plant_roadmap(client)
        milestone_id = roadmap["milestones"][0]["id"]

        # 작성 (사진 + 문구 + 줄글)
        resp = await client.put(
            f"/api/roadmap/milestones/{milestone_id}/post",
            data={"caption": "첫 완주!", "body": "3주 걸렸다. 뿌듯하다." * 5},
            files={"file": ("photo.png", _png_bytes(), "image/png")},
        )
        assert resp.status_code == 200
        post = resp.json()
        assert post["caption"] == "첫 완주!"
        assert post["has_image"] is True
        assert post["like_count"] == 0 and post["comment_count"] == 0

        # 리사이즈 확인: 1600px 원본 → 저장본 긴 변 1280 이하 JPEG
        session = await _get_session()
        from sqlalchemy import select

        from app.models.roadmap import MilestonePost

        db_post = await session.scalar(
            select(MilestonePost).where(MilestonePost.milestone_id == milestone_id)
        )
        assert db_post is not None and db_post.image_path is not None
        # 컨텍스트 매니저로 열어야 Windows에서 이후 파일 삭제가 막히지 않는다
        with Image.open(db_post.image_path) as saved:
            assert max(saved.size) <= 1280
            assert saved.format == "JPEG"
        image_file = Path(db_post.image_path)

        # 이미지 서빙 (공개)
        resp = await client.get(f"/api/roadmap/milestones/{milestone_id}/post/image")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"

        # 수정 (사진 제거)
        resp = await client.put(
            f"/api/roadmap/milestones/{milestone_id}/post",
            data={"caption": "수정된 문구", "remove_image": "true"},
        )
        assert resp.status_code == 200
        assert resp.json()["has_image"] is False
        assert not image_file.exists()  # 파일도 삭제

        # 상세 조회에 기록 포함
        resp = await client.get(f"/api/roadmap/{roadmap['id']}")
        ms = next(m for m in resp.json()["milestones"] if m["id"] == milestone_id)
        assert ms["post"]["caption"] == "수정된 문구"

        # 삭제
        resp = await client.delete(f"/api/roadmap/milestones/{milestone_id}/post")
        assert resp.status_code == 204
        resp = await client.get(f"/api/roadmap/{roadmap['id']}")
        ms = next(m for m in resp.json()["milestones"] if m["id"] == milestone_id)
        assert ms["post"] is None


@pytest.mark.asyncio
async def test_post_requires_ownership(owner_and_viewer) -> None:
    _, _, owner_token, viewer_token = owner_and_viewer
    async with _client() as client:
        client.cookies.set("cc_session", owner_token)
        roadmap = await _plant_roadmap(client)
        milestone_id = roadmap["milestones"][0]["id"]

    async with _client() as client:
        client.cookies.set("cc_session", viewer_token)
        resp = await client.put(
            f"/api/roadmap/milestones/{milestone_id}/post", data={"caption": "남의 것"}
        )
        assert resp.status_code == 403

    async with _client() as client:  # 비로그인
        resp = await client.put(
            f"/api/roadmap/milestones/{milestone_id}/post", data={"caption": "익명"}
        )
        assert resp.status_code == 401


@pytest.mark.asyncio
async def test_likes_and_comments(owner_and_viewer) -> None:
    owner, viewer, owner_token, viewer_token = owner_and_viewer
    async with _client() as client:
        client.cookies.set("cc_session", owner_token)
        roadmap = await _plant_roadmap(client)
        milestone_id = roadmap["milestones"][0]["id"]
        resp = await client.put(
            f"/api/roadmap/milestones/{milestone_id}/post", data={"caption": "좋아요 테스트"}
        )
        assert resp.status_code == 200

    async with _client() as client:
        client.cookies.set("cc_session", viewer_token)
        # 좋아요 (idempotent)
        for _ in range(2):
            resp = await client.post(f"/api/roadmap/milestones/{milestone_id}/post/like")
            assert resp.status_code == 204
        # 댓글 작성
        resp = await client.post(
            f"/api/roadmap/milestones/{milestone_id}/post/comments",
            json={"content": "축하해요! 저도 시작해야겠어요"},
        )
        assert resp.status_code == 201
        comment = resp.json()
        assert comment["can_delete"] is True  # 본인 댓글

        # 상세에서 카운트 반영 + liked_by_me
        resp = await client.get(f"/api/roadmap/{roadmap['id']}")
        ms = next(m for m in resp.json()["milestones"] if m["id"] == milestone_id)
        assert ms["post"]["like_count"] == 1
        assert ms["post"]["liked_by_me"] is True
        assert ms["post"]["comment_count"] == 1

        # 좋아요 취소
        resp = await client.delete(f"/api/roadmap/milestones/{milestone_id}/post/like")
        assert resp.status_code == 204

    # 소유자는 남의 댓글도 삭제 가능 (can_delete)
    async with _client() as client:
        client.cookies.set("cc_session", owner_token)
        resp = await client.get(f"/api/roadmap/milestones/{milestone_id}/post/comments")
        assert resp.status_code == 200
        comments = resp.json()
        assert len(comments) == 1
        assert comments[0]["can_delete"] is True  # 로드맵 소유자 권한
        resp = await client.delete(f"/api/roadmap/comments/{comments[0]['id']}")
        assert resp.status_code == 204

    # 비로그인도 댓글 목록은 열람 가능 (이제 0개)
    async with _client() as client:
        resp = await client.get(f"/api/roadmap/milestones/{milestone_id}/post/comments")
        assert resp.status_code == 200
        assert resp.json() == []


@pytest.mark.asyncio
async def test_comment_delete_forbidden_for_stranger(owner_and_viewer) -> None:
    owner, viewer, owner_token, viewer_token = owner_and_viewer
    session = await _get_session()
    stranger = await create_user(session, display_name="제3자", avatar_emoji="🎭")
    stranger_token = await create_session_token(session, stranger)
    try:
        async with _client() as client:
            client.cookies.set("cc_session", owner_token)
            roadmap = await _plant_roadmap(client)
            milestone_id = roadmap["milestones"][0]["id"]
            await client.put(
                f"/api/roadmap/milestones/{milestone_id}/post", data={"caption": "댓글 권한"}
            )
        async with _client() as client:
            client.cookies.set("cc_session", viewer_token)
            resp = await client.post(
                f"/api/roadmap/milestones/{milestone_id}/post/comments",
                json={"content": "구경꾼의 댓글"},
            )
            comment_id = resp.json()["id"]
        async with _client() as client:
            client.cookies.set("cc_session", stranger_token)
            resp = await client.delete(f"/api/roadmap/comments/{comment_id}")
            assert resp.status_code == 403
    finally:
        await delete_user_cascade(session, stranger.id)
