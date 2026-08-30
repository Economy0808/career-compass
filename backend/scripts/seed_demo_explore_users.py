"""탐색(Explore) 추천 폴백 데모용 계정을 Auth 에뮬레이터 + Firestore에 시드한다.

## 배경

실사용 계정이 test-observer/demo-analyst/demo-unverified 3개뿐이면, 소셜
탐색 화면에서 그중 하나를 팔로우하는 순간 추천 후보가 바닥나 "비슷한 사람
추천" 목록이 통째로 사라진다(app/api/explore.py의 2순위 폴백이 생겨도, 애초에
보여줄 후보 유저 자체가 없으면 소용이 없다). 이 스크립트는 그 자산(팔로우해볼
계정 여러 개)을 채운다.

## 관심사 태그 설계 의도

일부러 기존 계정(demo-analyst/test-observer)과 겹치는 태그를 가진 계정과
아예 안 겹치는(또는 태그가 하나도 없는) 계정을 섞었다 - 1순위(관심사 겹침)와
2순위(관심사 무관 폴백) 양쪽이 실제 화면에서 다 보이게 하려는 의도다.

## 팔로우 관계는 만들지 않는다

사용자가 직접 눌러볼 자산이어야 하므로, 이 스크립트는 계정만 만들고 아무도
서로 팔로우시키지 않는다.

Usage (backend/ 에서, 두 에뮬레이터가 이미 떠 있는 상태):
    .venv/Scripts/python.exe scripts/seed_demo_explore_users.py

재실행해도 안전하다(이미 있는 Auth 계정은 재생성/비밀번호 변경 없이 그대로
쓰고, Firestore 프로필 필드만 최신 시드값으로 갱신한다).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from firebase_admin import auth as fb_auth  # noqa: E402

from app.auth.firebase_auth import grant_yonsei_verified  # noqa: E402
from app.firestore import user_repo  # noqa: E402
from app.firestore.client import get_firestore_client  # noqa: E402

# 기존 데모 계정(demo-analyst 등)과 동일한 고정 비밀번호 - 데모 전용이며 실제
# 계정에는 절대 재사용하지 않는다.
_DEMO_PASSWORD = "observatory123!"

# (email, display_name, avatar_emoji, bio, interest_tags)
#
# hyun/somin은 demo-analyst("머신러닝기초", "경영통계")·test-observer("경영통계",
# "재무관리", "창업 동아리")와 태그가 겹치게 만들어 1순위 추천이 실제로 뜨는지
# 보여준다. jiho/areum은 완전히 무관한 태그라 두 계정에게는 2순위 폴백으로만
# 잡힌다. taein은 interest_tags를 아예 비워, "관심사 계산 전 신규 유저"까지
# 폴백이 커버하는지 보여준다.
_DEMO_USERS: list[tuple[str, str, str, str, list[str]]] = [
    (
        "demo-hyun@yonsei.ac.kr",
        "[데모] 현우",
        "🤖",
        "[데모] 계정입니다. 머신러닝으로 사회문제 풀고 싶어요.",
        ["머신러닝기초", "파이썬프로그래밍", "데이터시각화"],
    ),
    (
        "demo-somin@yonsei.ac.kr",
        "[데모] 소민",
        "📈",
        "[데모] 계정입니다. 경영 전략과 통계 둘 다 좋아해요.",
        ["경영통계", "재무관리", "창업 동아리"],
    ),
    (
        "demo-jiho@yonsei.ac.kr",
        "[데모] 지호",
        "🎸",
        "[데모] 계정입니다. 밴드 동아리에서 기타 치는 중이에요.",
        ["밴드동아리", "음악프로듀싱"],
    ),
    (
        "demo-areum@yonsei.ac.kr",
        "[데모] 아름",
        "🌏",
        "[데모] 계정입니다. 국제개발협력에 관심 있는 새내기예요.",
        ["국제개발협력", "교환학생준비"],
    ),
    (
        "demo-taein@yonsei.ac.kr",
        "[데모] 태인",
        "🏀",
        "[데모] 계정입니다. 아직 진로도 관심사도 탐색 중이에요.",
        [],
    ),
]


def _get_or_create_uid(email: str) -> str:
    """이메일로 Firebase Auth 계정을 찾고, 없으면 새로 만들어 uid를 반환한다(idempotent)."""
    try:
        return fb_auth.get_user_by_email(email).uid
    except fb_auth.UserNotFoundError:
        user = fb_auth.create_user(email=email, email_verified=True, password=_DEMO_PASSWORD)
        return user.uid


def main() -> None:
    if not os.environ.get("FIRESTORE_EMULATOR_HOST") or not os.environ.get(
        "FIREBASE_AUTH_EMULATOR_HOST"
    ):
        print(
            "ERROR: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST가 설정되지 "
            "않았습니다. 실제 프로젝트에 데모 계정을 만드는 사고를 막기 위해 중단합니다.",
            file=sys.stderr,
        )
        sys.exit(1)

    db = get_firestore_client()

    for email, display_name, avatar_emoji, bio, interest_tags in _DEMO_USERS:
        uid = _get_or_create_uid(email)
        grant_yonsei_verified(uid)
        # 두 리포지토리 함수를 그대로 재사용한다(read-merge-write, created_at
        # "최초 1회만" 규칙을 이 스크립트가 다시 구현할 필요가 없다).
        user_repo.update_profile(
            db, uid, display_name=display_name, avatar_emoji=avatar_emoji, bio=bio
        )
        user_repo.set_interest_tags(db, uid, interest_tags)
        print(f"seeded uid={uid} email={email} display_name={display_name}")

    print(f"완료: 데모 계정 {len(_DEMO_USERS)}개 시드/갱신.")


if __name__ == "__main__":
    main()
