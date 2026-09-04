"""학회/동아리 크라우드소싱 제출(academic_societies) 모더레이션 CLI (Stage B, 운영자 전용).

Usage (backend/ 에서, .venv 활성화 후):
    python scripts/moderate_societies.py list-pending
    python scripts/moderate_societies.py approve <department_id> <id>
    python scripts/moderate_societies.py reject <department_id> <id>

HTTP 관리자 엔드포인트나 role 기반 인가 시스템을 새로 만들지 않고 CLI로 하는
이유: 모더레이터가 창업자 1인뿐이다(브리핑 지시). 신고(POST .../report)로
pending에 떨어진 문서도, 최초 제출로 pending인 문서도 여기서 같이 검수한다.

Firestore Admin SDK는 동기(sync) 클라이언트라 refresh_certifications.py와
동일하게 asyncio 없이 작성했다.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.firestore import society_repo  # noqa: E402
from app.firestore.client import get_firestore_client  # noqa: E402


def _cmd_list_pending(db) -> None:
    pending = society_repo.list_pending(db)
    if not pending:
        print("대기중인 제출 없음")
        return
    for item in pending:
        flag = f"  [REPORTED by {item['reported_by']}]" if item.get("reported_by") else ""
        print(
            f"{item['department_id']}/{item['id']}  {item['kind']}  {item['name']}  "
            f"{item['official_url']}  (submitted_by={item['submitter_uid']}){flag}"
        )


def _cmd_moderate(db, department_id: str, doc_id: str, status: str) -> None:
    found = society_repo.set_moderation_status(
        db, department_id=department_id, doc_id=doc_id, status=status
    )
    if not found:
        print(f"에러: {department_id}/{doc_id} 문서를 찾을 수 없습니다.")
        raise SystemExit(1)
    print(f"{department_id}/{doc_id} -> {status}")


def main() -> None:
    parser = argparse.ArgumentParser(description="academic_societies 모더레이션 CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list-pending", help="전체 학과의 대기중(pending) 제출 나열")

    approve_p = sub.add_parser("approve", help="제출을 승인 처리")
    approve_p.add_argument("department_id")
    approve_p.add_argument("id")

    reject_p = sub.add_parser("reject", help="제출을 거절 처리")
    reject_p.add_argument("department_id")
    reject_p.add_argument("id")

    args = parser.parse_args()
    db = get_firestore_client()

    if args.command == "list-pending":
        _cmd_list_pending(db)
        return

    status = "approved" if args.command == "approve" else "rejected"
    _cmd_moderate(db, args.department_id, args.id, status)


if __name__ == "__main__":
    main()
