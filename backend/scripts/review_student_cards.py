"""학생증 심사 CLI (운영자용).

Usage (backend/ 에서, .venv 활성화 후):
    python scripts/review_student_cards.py list
    python scripts/review_student_cards.py approve <card_id>
    python scripts/review_student_cards.py reject <card_id> --reason "학생증이 아닙니다"

list는 심사 대기 건과 이미지 파일 경로를 보여준다. 이미지를 직접 열어
확인한 뒤 approve/reject 하면 이미지는 즉시 파기된다 (PIPA).
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.student_review import approve_card, list_pending, reject_card  # noqa: E402
from app.db import get_session_factory, reset_engine  # noqa: E402
from app.models.roadmap import User  # noqa: E402


async def cmd_list() -> None:
    async with get_session_factory()() as db:
        cards = await list_pending(db)
        if not cards:
            print("심사 대기 건이 없습니다.")
            return
        for card in cards:
            user = await db.get(User, card.user_id)
            name = user.display_name if user else "?"
            print(
                f"[{card.id}] user={card.user_id}({name}) uploaded={card.created_at} image={card.image_path}"
            )


async def cmd_approve(card_id: int) -> None:
    async with get_session_factory()() as db:
        await approve_card(db, card_id)
    print(f"card {card_id} approved — 이미지 파기 완료, 유저 연세대 인증 처리됨")


async def cmd_reject(card_id: int, reason: str) -> None:
    async with get_session_factory()() as db:
        await reject_card(db, card_id, reason)
    print(f"card {card_id} rejected — 이미지 파기 완료 (사유: {reason})")


async def main() -> None:
    parser = argparse.ArgumentParser(description="student card review CLI")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list")
    p_approve = sub.add_parser("approve")
    p_approve.add_argument("card_id", type=int)
    p_reject = sub.add_parser("reject")
    p_reject.add_argument("card_id", type=int)
    p_reject.add_argument("--reason", required=True)
    args = parser.parse_args()

    try:
        if args.command == "list":
            await cmd_list()
        elif args.command == "approve":
            await cmd_approve(args.card_id)
        elif args.command == "reject":
            await cmd_reject(args.card_id, args.reason)
    finally:
        await reset_engine()


if __name__ == "__main__":
    asyncio.run(main())
