"""NCS 직무·능력단위 조회 (내부 DB 그라운딩).

직무 매칭은 3단 폴백이다:

1. pgvector 임베딩 (의미 매칭) — OPENAI_API_KEY가 있고 백필된 행이 있을 때만.
2. pg_trgm 유사도 (표기 변형 매칭) — 기본 경로. 키 없이 동작하며 띄어쓰기·약어
   변형("데이터 분석" ↔ "빅데이터분석", "SW" ↔ "소프트웨어")을 잡는다.
3. ILIKE 부분일치 — 마지막 안전망.

어느 단계도 못 찾으면 빈 결과를 돌려 서비스가 우아하게 축소한다(NCS 데이터가
아직 없는 초기·테스트 환경 포함).
"""

import logging

from sqlalchemy import Float, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.llm.base import AbilityUnitRef
from app.llm.embeddings import embed_texts
from app.models.ncs import NcsAbilityUnit, NcsJob

logger = logging.getLogger(__name__)

# 학생이 쓰는 말 -> NCS 직무명 표기. NCS는 약어를 거의 안 쓰기 때문에 확장 방향은
# 항상 "구어 -> 공식 표기" 한 방향이다.
_SYNONYMS: dict[str, str] = {
    "SW": "소프트웨어",
    "HW": "하드웨어",
    "AI": "인공지능",
    "IT": "정보기술",
    "DB": "데이터베이스",
    "UX": "사용자경험",
    "UI": "사용자인터페이스",
    "PM": "프로젝트관리",
    "HR": "인적자원",
    "QA": "품질보증",
    "마케터": "마케팅",
    "개발자": "개발",
    "디자이너": "디자인",
    "기획자": "기획",
    "엔지니어": "공학",
    "애널리스트": "분석",
    "컨설턴트": "컨설팅",
}

# 이 밑으로는 매칭이 아니라 소음이다 (trgm 유사도 0~1).
_TRGM_THRESHOLD = 0.2


def _embeddings_enabled() -> bool:
    """임베딩 매칭 사용 여부. 테스트에서 monkeypatch하는 지점."""
    return get_settings().use_real_embeddings


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


async def _shortlist_by_embedding(db: AsyncSession, terms: list[str], limit: int) -> list[NcsJob]:
    """임베딩 코사인 거리로 가장 가까운 직무를 찾는다."""
    query_vector = (await embed_texts([" ".join(terms)]))[0]
    stmt = (
        select(NcsJob)
        .where(NcsJob.is_current.is_(True), NcsJob.embedding.is_not(None))
        .order_by(NcsJob.embedding.cosine_distance(query_vector))
        .limit(limit)
    )
    return list((await db.scalars(stmt)).all())


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
    """키워드로 NCS 직무 후보를 찾는다 (임베딩 → trgm → ILIKE 순 폴백)."""
    terms = [k.strip() for k in keywords if k and k.strip()]
    if not terms:
        return []

    if _embeddings_enabled():
        try:
            rows = await _shortlist_by_embedding(db, terms, limit)
            if rows:
                return rows
        except Exception:
            # 임베딩은 부가 정밀화일 뿐이라 실패해도 로드맵 생성을 막지 않는다.
            logger.warning("embedding shortlist failed; falling back to trgm", exc_info=True)

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
