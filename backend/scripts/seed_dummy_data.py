"""로드맵 SNS 프로토타입용 더미 유저/로드맵 시드 스크립트.

인증이 없는 프로토타입이라 피드가 비어있지 않도록 더미 유저 5명과
각자의 샘플 로드맵/마일스톤을 심는다. 이미 유저가 존재하면 아무것도
하지 않는다 (idempotent, 재실행해도 중복 생성 안 됨).

사용법:
    cd backend
    python scripts/seed_dummy_data.py
"""

import asyncio
from datetime import date, datetime, timedelta

from sqlalchemy import select

import app.db as db
from app.models.roadmap import Milestone, Roadmap, User

TODAY = date.today()


def _days(offset: int) -> date:
    return TODAY + timedelta(days=offset)


DUMMY_USERS = [
    {"display_name": "재민", "avatar_emoji": "🦉"},
    {"display_name": "소연", "avatar_emoji": "🐰"},
    {"display_name": "도윤", "avatar_emoji": "🐢"},
    {"display_name": "하은", "avatar_emoji": "🦊"},
    {"display_name": "민준", "avatar_emoji": "🐼"},
]

# (user_index, title, goal_raw_text, milestones)
# milestones: (title, description, due_date_offset_days, is_completed_manual)
DUMMY_ROADMAPS = [
    (
        0,
        "데이터 분석가 되기",
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
        "프론트엔드 개발자 취업",
        "프론트엔드 개발자로 취업하고 싶어",
        [
            ("HTML/CSS/JS 기초", "웹 표준 문법 학습", -45, True),
            ("React 학습", "컴포넌트, 훅, 상태관리 학습", -5, True),
            ("개인 포트폴리오 사이트 제작", "Next.js로 포트폴리오 배포", 14, False),
            ("기업 코딩 테스트 준비", "알고리즘 문제 매일 1개씩 풀기", 45, False),
        ],
    ),
    (
        2,
        "공인회계사(CPA) 1차 합격",
        "공인회계사가 되고 싶어",
        [
            ("회계원리 기초 완강", "회계원리 인강 완강 및 기본서 1회독", -20, True),
            ("세법 기본서 1회독", "세법 기본 개념 정리", -3, False),
            ("재무관리 기본서 1회독", "재무관리 기본 개념 정리", 20, False),
            ("모의고사 5회 응시", "실전 모의고사로 시간 배분 연습", 50, False),
            ("1차 시험 응시", "CPA 1차 시험 응시", 90, False),
            ("오답노트 정리", "틀린 문제 유형별 정리", 95, False),
        ],
    ),
    (
        3,
        "UX 디자이너 전환",
        "UX 디자이너가 되고 싶어",
        [
            ("UX 리서치 기초 학습", "사용자 인터뷰, 설문 설계 학습", -15, True),
            ("Figma 툴 숙련", "Figma로 와이어프레임/프로토타입 제작 연습", -2, False),
            ("리디자인 프로젝트 1개", "기존 앱 하나 골라 리디자인", 21, False),
            ("포트폴리오 웹사이트 제작", "프로젝트 3개로 포트폴리오 사이트 완성", 60, False),
        ],
    ),
    (
        4,
        "백엔드 개발자, 스타트업 취업",
        "백엔드 개발자로 스타트업에 취업하고 싶어",
        [
            ("Python/FastAPI 기초", "FastAPI로 간단한 API 서버 만들기", -25, True),
            ("DB 설계 및 SQL 심화", "정규화, 인덱스, 쿼리 최적화 학습", -8, True),
            ("사이드 프로젝트 배포", "개인 프로젝트 클라우드에 배포", 10, False),
            ("오픈소스 기여 1건", "관심 있는 오픈소스 프로젝트에 PR 제출", 40, False),
            ("스타트업 채용 지원", "스타트업 5곳 이상 지원", 70, False),
        ],
    ),
]


async def main() -> None:
    db._get_engine()
    assert db._session_factory is not None
    async with db._session_factory() as session:
        existing = await session.scalar(select(User).limit(1))
        if existing is not None:
            print("이미 유저 데이터가 존재합니다. 시드를 건너뜁니다.")
            return

        users = [User(**u) for u in DUMMY_USERS]
        session.add_all(users)
        await session.flush()

        for user_index, title, goal_raw_text, milestone_specs in DUMMY_ROADMAPS:
            roadmap = Roadmap(
                user_id=users[user_index].id,
                title=title,
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

        await session.commit()
        print(f"더미 유저 {len(users)}명, 로드맵 {len(DUMMY_ROADMAPS)}개 시드 완료.")


if __name__ == "__main__":
    asyncio.run(main())
