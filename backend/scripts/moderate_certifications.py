"""유저 제보 자격증(user_certifications) 모더레이션 CLI (운영자 전용).

Usage (backend/ 에서, .venv 활성화 후):
    python scripts/moderate_certifications.py list-pending
    python scripts/moderate_certifications.py approve <id>
    python scripts/moderate_certifications.py reject <id>

scripts/moderate_societies.py와 동일한 이유(창업자 1인 운영, 브리핑 지시)로
HTTP 관리자 엔드포인트나 role 기반 인가 시스템 없이 CLI로만 처리한다. 신고
(POST .../report)로 pending에 떨어진 문서도, 최초 제출로 pending인 문서도
여기서 같이 검수한다. 이 컬렉션은 큐레이션 자격증(certifications)과 완전히
분리돼 있으므로 approve해도 verified=True로 격상되지 않는다 - 큐레이션
승격이 필요하면 별도로 app/etl/seeds/certifications_curated.json에 반영하고
scripts/load_curated_certifications.py로 적재할 것.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.firestore import user_certification_repo  # noqa: E402
from app.firestore.client import get_firestore_client  # noqa: E402


def _cmd_list_pending(db) -> None:
    pending = user_certification_repo.list_pending(db)
    if not pending:
        print("대기중인 제보 없음")
        return
    for item in pending:
        flag = f"  [REPORTED by {item['reported_by']}]" if item.get("reported_by") else ""
        print(
            f"{item['id']}  {item['name']}  {item['issuer']}  {item['official_url']}  "
            f"(submitted_by={item['submitter_uid']}){flag}"
        )


def _cmd_moderate(db, doc_id: str, status: str) -> None:
    found = user_certification_repo.set_moderation_status(db, doc_id=doc_id, status=status)
    if not found:
        print(f"에러: {doc_id} 문서를 찾을 수 없습니다.")
        raise SystemExit(1)
    print(f"{doc_id} -> {status}")


def main() -> None:
    parser = argparse.ArgumentParser(description="user_certifications 모더레이션 CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list-pending", help="전체 대기중(pending) 제보 나열")

    approve_p = sub.add_parser("approve", help="제보를 승인 처리")
    approve_p.add_argument("id")

    reject_p = sub.add_parser("reject", help="제보를 거절 처리")
    reject_p.add_argument("id")

    args = parser.parse_args()
    db = get_firestore_client()

    if args.command == "list-pending":
        _cmd_list_pending(db)
        return

    status = "approved" if args.command == "approve" else "rejected"
    _cmd_moderate(db, args.id, status)


if __name__ == "__main__":
    main()
