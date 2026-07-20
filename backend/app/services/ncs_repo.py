"""NCS 직무·능력단위 조회 (내부 DB 그라운딩).

직무 매칭의 주 경로는 **유저가 고른 대분류 안에서 LLM이 판정**하는 것이다
(roadmap_gen이 오케스트레이션). 유저가 분야를 안 골랐거나 LLM이 없을 때만
문자열 매칭으로 축소한다: pg_trgm 유사도 → ILIKE 부분일치.

**왜 문자열/벡터 매칭을 주 경로에서 뺐나 (2026-07-20 실측)**:
- 임베딩(pgvector)은 "모르겠다"를 말할 줄 모른다. 정렬만 하므로 NCS에 없는 직무를
  물어도 가장 가까운 행을 자신 있게 준다: "창업"->창호시공, "퀀트"->헤어미용.
- 거리 임계값으로 정답/노이즈를 가르려 했으나 **분리가 불가능**했다. 색인 텍스트
  형식 3종·LLM 질의 확장까지 시도했지만 전부 마진이 음수였다. 근본 원인은 코사인
  거리가 "관련 있음"을 잴 뿐 "이게 그 직무임"을 재지 않는다는 것 — 간호사는 NCS에
  없지만 "병원행정"은 진짜로 관련 있어서, 인접한 것과 맞는 것을 거리로 못 가른다.
- 판정은 분류 문제이므로 분류기(LLM)에 맡긴다. 대분류를 유저가 고르면 후보가
  1,094개에서 평균 46개로 줄어 토큰 비용이 60원에서 2원 수준이 된다.

어느 경로도 못 찾으면 빈 결과를 돌려 서비스가 우아하게 축소한다(NCS 데이터가
아직 없는 초기·테스트 환경 포함). 그라운딩이므로 **틀린 매칭은 없는 매칭보다 나쁘다.**
"""

import logging
from dataclasses import dataclass

from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.base import AbilityUnitRef, NcsJobOption
from app.models.ncs import NcsAbilityUnit, NcsJob, NcsLclas, NcsSclas

logger = logging.getLogger(__name__)


# 1~2학년 무전공 학부생이 가장 많이 고를 분야 — 프론트가 이것만 먼저 펼쳐 보여주고
# 나머지는 "기타"로 접는다. 직무 수 순이 아니라 학생 관련성 기준의 큐레이션이다
# (기계·건설이 직무 수는 제일 많지만 이 서비스 사용자와는 거리가 멀다).
FEATURED_LCLAS_CODES = ("20", "02", "03", "08", "04")

# 한 번에 고를 수 있는 분야 수. 후보 수가 곧 판정 프롬프트 크기라 상한이 필요하다
# (최대 3개라도 최악 400여 직무 ≈ 5.4k 토큰).
MAX_LCLAS_SELECTION = 3


@dataclass
class LclasOption:
    """유저에게 보여줄 대분류 선택지."""

    code: str
    name: str
    job_count: int
    featured: bool


# 학생이 쓰는 말 -> NCS 직무명 표기. NCS는 약어를 거의 안 쓰기 때문에 확장 방향은
# 항상 "구어 -> 공식 표기" 한 방향이다.
# 매핑 대상은 전부 실제 NCS 직무명에 존재하는 표기로만 둔다. NCS에 없는 말로
# 보내면(예전 "HR"->"인적자원", "엔지니어"->"공학") 후보만 늘고 매칭은 0건이다.
_SYNONYMS: dict[str, str] = {
    "SW": "소프트웨어",
    "HW": "하드웨어",
    "AI": "인공지능",
    "IT": "정보기술",
    # NCS 표기가 "DB엔지니어링"이라 이 쌍만 확장 방향이 반대다 (구어가 "데이터베이스").
    "데이터베이스": "DB",
    "UX": "UI/UX엔지니어링",
    "UI": "UI/UX엔지니어링",
    "PM": "프로젝트관리",
    "HR": "인사",
    "QA": "품질보증",
    "마케터": "마케팅",
    "개발자": "개발",
    "디자이너": "디자인",
    "기획자": "기획",
    "엔지니어": "엔지니어링",
    "애널리스트": "분석",
    "컨설턴트": "컨설팅",
    # 학생이 흔히 쓰는 직업명 -> NCS 표기. NCS에 대응 직무가 실제로 있는 것만 넣는다
    # (간호사·교사·약사·공무원 등은 별도 법정 자격 체계라 NCS에 없다 — 빈손이 정답).
    "퀀트": "리스크관리",
    "펀드매니저": "자산관리",
    "트레이더": "투자",
    "세무사": "세무",
    "변리사": "지식재산",
    "노무사": "인사",
    "승무원": "항공객실",
    "아나운서": "방송",
    "요리사": "조리",
    "셰프": "조리",
    "상담사": "상담",
    "유튜버": "콘텐츠",
    "크리에이터": "콘텐츠",
}

# 이 밑으로는 매칭이 아니라 소음이다 (trgm 유사도 0~1).
_TRGM_THRESHOLD = 0.2


def _expand_terms(terms: list[str]) -> list[str]:
    """동의어 치환본을 후보에 추가하고 공백을 제거한다 (NCS 직무명은 붙여쓰기)."""
    expanded: list[str] = []
    for term in terms:
        candidates = [term]
        for src, dst in _SYNONYMS.items():
            if src.lower() in term.lower():
                # 대소문자 무시 치환 (SW/sw 모두 잡히게)
                idx = term.lower().index(src.lower())
                candidates.append(term[:idx] + dst + term[idx + len(src) :])
        for candidate in candidates:
            squished = candidate.replace(" ", "")
            if squished and squished not in expanded:
                expanded.append(squished)
    return expanded


async def list_lclas(db: AsyncSession) -> list[LclasOption]:
    """유저에게 보여줄 NCS 대분류 목록 (직무가 있는 것만, 많은 순)."""
    rows = (
        await db.execute(
            select(NcsLclas.code, NcsLclas.name, func.count(NcsJob.code).label("n"))
            .join(
                NcsJob,
                (NcsJob.lclas_code == NcsLclas.code)
                & (NcsJob.degree == NcsLclas.degree)
                & NcsJob.is_current.is_(True),
            )
            .where(NcsLclas.is_current.is_(True))
            .group_by(NcsLclas.code, NcsLclas.name)
            .order_by(func.count(NcsJob.code).desc(), NcsLclas.name)
        )
    ).all()
    return [
        LclasOption(code=c, name=n, job_count=cnt, featured=c in FEATURED_LCLAS_CODES)
        for c, n, cnt in rows
    ]


async def jobs_in_lclas(db: AsyncSession, lclas_codes: list[str]) -> list[NcsJobOption]:
    """고른 대분류들에 속한 현행 직무 전체 (LLM 판정 후보).

    소분류명을 함께 넘긴다 — 직무명만으로는 모호한 경우("품질관리")를 모델이
    문맥으로 구분할 수 있어야 한다.
    """
    codes = list(dict.fromkeys(c for c in lclas_codes if c))[:MAX_LCLAS_SELECTION]
    if not codes:
        return []
    rows = (
        await db.execute(
            select(NcsJob.code, NcsJob.name, NcsSclas.name)
            .join(
                NcsSclas,
                (NcsSclas.code == NcsJob.sclas_code) & (NcsSclas.degree == NcsJob.degree),
            )
            .where(NcsJob.is_current.is_(True), NcsJob.lclas_code.in_(codes))
            .order_by(NcsJob.name)
        )
    ).all()
    return [NcsJobOption(code=c, name=n, sclas_name=s) for c, n, s in rows]


async def get_job(db: AsyncSession, code: str) -> NcsJob | None:
    """직무 코드로 현행 직무를 가져온다 (LLM이 낸 코드 검증용)."""
    stmt = select(NcsJob).where(NcsJob.is_current.is_(True), NcsJob.code == code).limit(1)
    return (await db.scalars(stmt)).first()


async def _shortlist_by_trgm(db: AsyncSession, terms: list[str], limit: int) -> list[NcsJob]:
    """pg_trgm 유사도 매칭. 직무명의 공백을 지워 띄어쓰기 변형을 흡수한다."""
    expanded = _expand_terms(terms)
    if not expanded:
        return []
    normalized_name = func.replace(NcsJob.name, " ", "")
    score = func.greatest(
        *[cast(func.similarity(normalized_name, term), Float) for term in expanded]
    )
    stmt = (
        select(NcsJob)
        .where(NcsJob.is_current.is_(True), score > _TRGM_THRESHOLD)
        .order_by(score.desc())
        .limit(limit)
    )
    return list((await db.scalars(stmt)).all())


async def _shortlist_by_ilike(db: AsyncSession, terms: list[str], limit: int) -> list[NcsJob]:
    """부분일치 매칭 (최후 안전망). 현재판 우선, 없으면 전체에서 재시도."""
    conditions = [NcsJob.name.ilike(f"%{t}%") for t in terms]
    stmt = select(NcsJob).where(NcsJob.is_current.is_(True)).where(or_(*conditions)).limit(limit)
    rows = list((await db.scalars(stmt)).all())
    if rows:
        return rows
    # 현재 버전에서 못 찾으면 전체에서 재시도 (데이터 상태에 관대하게)
    stmt = select(NcsJob).where(or_(*conditions)).limit(limit)
    return list((await db.scalars(stmt)).all())


async def shortlist_jobs(db: AsyncSession, keywords: list[str], limit: int = 3) -> list[NcsJob]:
    """키워드로 NCS 직무 후보를 찾는다 (trgm → ILIKE 폴백).

    유저가 분야를 안 골랐을 때만 쓰는 축소 경로다. 주 경로는 roadmap_gen이
    대분류 후보를 LLM에 넘겨 판정시키는 쪽.
    """
    terms = [k.strip() for k in keywords if k and k.strip()]
    if not terms:
        return []

    rows = await _shortlist_by_trgm(db, terms, limit)
    if rows:
        return rows
    return await _shortlist_by_ilike(db, terms, limit)


async def ability_units_for(
    db: AsyncSession, job_code: str, limit: int = 20
) -> list[AbilityUnitRef]:
    """직무 코드에 속한 능력단위를 가져온다.

    같은 능력단위가 개정판(degree)마다 행으로 존재하므로 현재판 우선 + 이름 중복
    제거로 LLM 그라운딩 슬롯이 낭비되지 않게 한다.
    """
    stmt = (
        select(NcsAbilityUnit)
        .where(NcsAbilityUnit.job_code == job_code)
        .order_by(NcsAbilityUnit.is_current.desc(), NcsAbilityUnit.degree.desc())
    )
    rows = (await db.scalars(stmt)).all()
    seen: set[str] = set()
    units: list[AbilityUnitRef] = []
    for u in rows:
        if u.name in seen:
            continue
        seen.add(u.name)
        units.append(AbilityUnitRef(code=u.code, name=u.name))
        if len(units) >= limit:
            break
    return units
