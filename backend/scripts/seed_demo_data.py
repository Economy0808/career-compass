"""Cloudflare 포트폴리오 데모용 시드 스크립트.

scripts/seed_dummy_data.py(인증 이전 프로토타입용, 로컬 개발 DB에서 계속 쓰임)와
달리, 이건 로그인 가능한 가짜 계정 + 대목표/로드맵 구조까지 채운다 —
방문자가 실제로 눌러보고 로그인해볼 수 있는 데모를 만드는 게 목적이다.

**절대 실제 개발 DB에 실행하지 말 것.** DATABASE_URL이 가리키는 곳에 곧바로
INSERT하므로, 반드시 Neon/Supabase 등 데모 전용 DB로 .env를 맞춘 뒤 실행한다.
어떤 계정도 실제 사람이 아니다 — 전부 example.com 이메일의 합성 데이터.

Usage (backend/ 에서, 데모용 .env 확인 후):
    python scripts/seed_demo_data.py --yes

이미 유저 데이터가 있으면 아무것도 안 한다 (idempotent, 재실행해도 중복 생성 안 됨).
"""

import argparse
import asyncio
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.db import get_session_factory  # noqa: E402
from app.models.roadmap import (  # noqa: E402
    BeanTransaction,
    CareerGoal,
    Follow,
    Milestone,
    Roadmap,
    User,
)

TODAY = date.today()
DEMO_PASSWORD = "demo1234"  # 로그인 데모용. 실제 계정에는 절대 재사용하지 말 것.


def _days(offset: int) -> date:
    return TODAY + timedelta(days=offset)


# (username, display_name, avatar_emoji, bio, yonsei_verified)
DEMO_USERS = [
    ("demo_jaemin", "재민", "🦉", "데이터로 진로 찾는 중", True),
    ("demo_soyeon", "소연", "🐰", "UX 디자이너 준비생", True),
    ("demo_doyun", "도윤", "🐢", "천천히, 그러나 꾸준히", False),
    ("demo_haeun", "하은", "🦊", "백엔드 개발자가 목표", True),
    ("demo_minjun", "민준", "🐼", "회계사 시험 준비중", False),
    ("demo_yuna", "유나", "🌙", "마케터로 커리어 전환", True),
]

# (user_index, goal_title, goal_context, roadmap_title, goal_raw_text, milestones)
# milestones: (title, description, due_date_offset_days, is_completed_manual)
DEMO_GOALS = [
    (
        0,
        "데이터 분석가 되기",
        "3학년, 통계학 전공, 주당 15시간 투자 가능. SQL/파이썬 기초 있음.",
        "데이터 분석가 취업 로드맵",
        "데이터 분석가가 되고 싶어",
        [
            ("SQL 기초 학습", "SQL 기본 문법과 JOIN 익히기", -30, True),
            ("Python 데이터 분석 기초", "pandas, numpy로 데이터 다루는 법 학습", -10, True),
            ("포트폴리오 프로젝트 1개", "공공데이터로 분석 프로젝트 완성", 7, False),
            ("데이터 분석 부트캠프 지원", "국비지원 부트캠프 3곳 지원", 30, False),
            ("인턴십 지원", "데이터 분석 직무 인턴 지원 시작", 60, False),
        ],
    ),
    (
        1,
        "UX 디자이너 전환",
        "2학년, 시각디자인 전공, 포트폴리오 0개.",
        "UX 디자이너 포트폴리오 만들기",
        "UX 디자이너가 되고 싶어",
        [
            ("UX 리서치 기초 학습", "사용자 인터뷰, 설문 설계 학습", -15, True),
            ("Figma 툴 숙련", "Figma로 와이어프레임/프로토타입 제작 연습", -2, False),
            ("리디자인 프로젝트 1개", "기존 앱 하나 골라 리디자인", 21, False),
            ("포트폴리오 웹사이트 제작", "프로젝트 3개로 포트폴리오 사이트 완성", 60, False),
        ],
    ),
    (
        2,
        "공인회계사(CPA) 1차 합격",
        "4학년, 경영학 전공, 올해 1차 응시 목표.",
        "CPA 1차 시험 준비",
        "공인회계사가 되고 싶어",
        [
            ("회계원리 기초 완강", "회계원리 인강 완강 및 기본서 1회독", -20, True),
            ("세법 기본서 1회독", "세법 기본 개념 정리", -3, False),
            ("재무관리 기본서 1회독", "재무관리 기본 개념 정리", 20, False),
            ("모의고사 5회 응시", "실전 모의고사로 시간 배분 연습", 50, False),
            ("1차 시험 응시", "CPA 1차 시험 응시", 90, False),
        ],
    ),
    (
        3,
        "백엔드 개발자, 스타트업 취업",
        "3학년, 컴퓨터공학 전공, FastAPI 토이프로젝트 1개 경험.",
        "백엔드 개발자 취업 로드맵",
        "백엔드 개발자로 스타트업에 취업하고 싶어",
        [
            ("Python/FastAPI 기초", "FastAPI로 간단한 API 서버 만들기", -25, True),
            ("DB 설계 및 SQL 심화", "정규화, 인덱스, 쿼리 최적화 학습", -8, True),
            ("사이드 프로젝트 배포", "개인 프로젝트 클라우드에 배포", 10, False),
            ("오픈소스 기여 1건", "관심 있는 오픈소스 프로젝트에 PR 제출", 40, False),
            ("스타트업 채용 지원", "스타트업 5곳 이상 지원", 70, False),
        ],
    ),
    (
        4,
        "전략 컨설턴트(MBB) 되기",
        "1학년, 무전공, 케이스인터뷰 경험 없음.",
        "컨설팅 케이스인터뷰 준비",
        "전략 컨설턴트가 되고 싶어",
        [
            ("케이스인터뷰 기초체력 완성 #1", "구조화 사고, 프레임워크 학습", -12, False),
            ("케이스 스터디 그룹 참여", "매주 케이스 2개씩 실전 연습", 5, False),
            ("리서치 프로젝트 1건", "산업 분석 리포트 작성", 35, False),
        ],
    ),
    (
        5,
        "마케터로 커리어 전환",
        "3학년, 심리학 전공, 인턴 경험 1회.",
        "마케팅 직무 전환 로드맵",
        "그로스 마케터가 되고 싶어",
        [
            ("퍼포먼스 마케팅 기초", "GA4, 메타 광고 매니저 학습", -18, True),
            ("SNS 콘텐츠 캠페인 1건", "개인 채널로 캠페인 기획·집행", -1, True),
            ("마케팅 인턴 지원", "스타트업 마케팅 인턴 5곳 지원", 25, False),
        ],
    ),
]

# (follower_index, followee_index)
DEMO_FOLLOWS = [(0, 3), (1, 5), (2, 0), (3, 1), (4, 2), (5, 4), (0, 1)]


async def main(confirm: bool) -> None:
    settings = get_settings()
    parsed = urlsplit(settings.database_url)
    target = f"{parsed.hostname}{parsed.path}"
    print(f"대상 DB: {target}")

    if not confirm:
        print(
            "실행하려면 --yes를 붙이세요. 반드시 데모 전용 DB인지 위 주소를 눈으로 "
            "확인한 뒤 진행할 것 — 로컬 개발 DB(localhost)에는 실행하지 마세요."
        )
        return

    session_factory = get_session_factory()
    async with session_factory() as session:
        existing = await session.scalar(select(User).limit(1))
        if existing is not None:
            print("이미 유저 데이터가 존재합니다. 시드를 건너뜁니다.")
            return

        pw_hash = hash_password(DEMO_PASSWORD)
        users = [
            User(
                username=username,
                email=f"{username}@example.com",
                password_hash=pw_hash,
                display_name=display_name,
                avatar_emoji=emoji,
                bio=bio,
                email_verified_at=datetime.now(),
                yonsei_verified_at=datetime.now() if yonsei else None,
                verification_method="school_email" if yonsei else None,
            )
            for username, display_name, emoji, bio, yonsei in DEMO_USERS
        ]
        session.add_all(users)
        await session.flush()

        for (
            user_index,
            goal_title,
            goal_context,
            roadmap_title,
            goal_raw_text,
            milestone_specs,
        ) in DEMO_GOALS:
            career_goal = CareerGoal(
                user_id=users[user_index].id,
                title=goal_title,
                context=goal_context,
            )
            session.add(career_goal)
            await session.flush()

            roadmap = Roadmap(
                user_id=users[user_index].id,
                career_goal_id=career_goal.id,
                title=roadmap_title,
                goal_raw_text=goal_raw_text,
                chat_transcript=None,
            )
            roadmap.milestones = [
                Milestone(
                    order_index=i,
                    title=m_title,
                    description=m_desc,
                    due_date=_days(offset),
                    is_completed_manual=is_done,
                    completed_at=datetime.now() if is_done else None,
                )
                for i, (m_title, m_desc, offset, is_done) in enumerate(milestone_specs)
            ]
            session.add(roadmap)
            await session.flush()

            # 전부 완료된 로드맵은 완주 콩을 지급해 랭킹 화면도 비어있지 않게 한다.
            if all(m.is_completed_manual for m in roadmap.milestones):
                roadmap.beans_awarded_at = datetime.now()
                session.add(
                    BeanTransaction(
                        user_id=users[user_index].id,
                        amount=10,
                        reason="roadmap_completed",
                    )
                )

        session.add_all(
            Follow(follower_id=users[a].id, followee_id=users[b].id) for a, b in DEMO_FOLLOWS
        )

        await session.commit()
        print(
            f"데모 유저 {len(users)}명, 대목표/로드맵 {len(DEMO_GOALS)}개 시드 완료. "
            f"모든 계정 비밀번호: {DEMO_PASSWORD}"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="확인 없이 바로 시딩 실행")
    args = parser.parse_args()
    asyncio.run(main(args.yes))
