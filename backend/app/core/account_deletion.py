"""회원 탈퇴 시 유저의 모든 데이터를 하드 삭제한다 (PIPA 삭제권).

async에서 ORM cascade는 lazy load로 깨질 수 있어 벌크 DELETE로 FK 순서를 직접
지킨다: 하위(좋아요/댓글→기록→마일스톤) → 유저 참조 행 → 로드맵 → 유저.
업로드 파일(마일스톤 기록 이미지·학생증 이미지)은 삭제 전에 파기한다.
"""
from pathlib import Path

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import AuthSession, EmailVerification, StudentCardVerification
from app.models.roadmap import (
    BeanTransaction,
    Follow,
    Milestone,
    MilestonePost,
    PostComment,
    PostLike,
    Roadmap,
    User,
)
from app.models.todo import TodoCategory, TodoItem


def _unlink(path_str: str | None) -> None:
    if not path_str:
        return
    p = Path(path_str)
    if p.exists():
        p.unlink()


async def delete_account(db: AsyncSession, user: User) -> None:
    uid = user.id

    my_roadmaps = select(Roadmap.id).where(Roadmap.user_id == uid)
    my_milestones = select(Milestone.id).where(Milestone.roadmap_id.in_(my_roadmaps))
    my_posts = select(MilestonePost.id).where(MilestonePost.milestone_id.in_(my_milestones))

    # 1) 파일 파기 (PIPA): 내 기록 이미지 + 남아있는 학생증 이미지
    post_images = (
        await db.scalars(
            select(MilestonePost.image_path).where(
                MilestonePost.id.in_(my_posts), MilestonePost.image_path.is_not(None)
            )
        )
    ).all()
    card_images = (
        await db.scalars(
            select(StudentCardVerification.image_path).where(
                StudentCardVerification.user_id == uid,
                StudentCardVerification.image_path.is_not(None),
            )
        )
    ).all()
    for path in [*post_images, *card_images]:
        _unlink(path)

    # 2) 내 글의 좋아요/댓글 + 내가 타인 글에 남긴 좋아요/댓글
    await db.execute(delete(PostLike).where(or_(PostLike.post_id.in_(my_posts), PostLike.user_id == uid)))
    await db.execute(
        delete(PostComment).where(or_(PostComment.post_id.in_(my_posts), PostComment.user_id == uid))
    )
    # 3) 내 기록 → 마일스톤
    await db.execute(delete(MilestonePost).where(MilestonePost.milestone_id.in_(my_milestones)))
    await db.execute(delete(Milestone).where(Milestone.roadmap_id.in_(my_roadmaps)))

    # 4) 유저 참조 행들
    await db.execute(delete(BeanTransaction).where(BeanTransaction.user_id == uid))
    await db.execute(delete(TodoItem).where(TodoItem.user_id == uid))  # items before categories
    await db.execute(delete(TodoCategory).where(TodoCategory.user_id == uid))
    await db.execute(delete(AuthSession).where(AuthSession.user_id == uid))
    await db.execute(delete(EmailVerification).where(EmailVerification.user_id == uid))
    await db.execute(delete(StudentCardVerification).where(StudentCardVerification.user_id == uid))
    await db.execute(
        delete(Follow).where(or_(Follow.follower_id == uid, Follow.followee_id == uid))
    )

    # 5) 로드맵 → 유저
    await db.execute(delete(Roadmap).where(Roadmap.user_id == uid))
    await db.execute(delete(User).where(User.id == uid))
    await db.commit()
