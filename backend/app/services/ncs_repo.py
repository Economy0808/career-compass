"""NCS 직무·능력단위 조회 (내부 DB 그라운딩).

직무 매칭은 3단 폴백이다:

1. pg_trgm 유사도 (표기 변형 매칭) — 기본 경로. 키 없이 동작하며 띄어쓰기·약어
   변형("데이터 분석" ↔ "빅데이터분석", "SW" ↔ "소프트웨어")을 잡는다.
2. pgvector 임베딩 (의미 매칭) — trgm이 빈손일 때만, 그리고 충분히 가까울 때만.
   글자가 안 겹쳐도 의미가 가까운 경우를 메운다("게임 기획" -> "게임콘텐츠제작").
3. ILIKE 부분일치 — 마지막 안전망.

**순서가 trgm 우선인 이유**: 임베딩은 "모르겠다"를 말할 줄 모른다. 정렬만 할 뿐이라
NCS에 없는 직무("창업", "간호사")를 물어도 가장 가까운 행을 자신 있게 돌려준다
(실측: "창업" -> "창호시공"). 반면 trgm은 임계값 아래를 잘라내 빈손을 반환한다.
로드맵 생성에 들어가는 그라운딩이므로 **틀린 매칭은 없는 매칭보다 나쁘다.**
그래서 정밀한 trgm을 먼저 쓰고, 임베딩은 거리 임계값을 건 보조 수단으로 둔다.

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

# 이 거리를 넘으면 "가장 가깝다"일 뿐 의미가 통하는 매칭이 아니다 (코사인 거리 0~2).
# 실측 기준값: 정답으로 볼 만한 매칭은 "게임 기획"->게임콘텐츠제작 0.473,
# "심리상담"->심리상담 0.455, "데이터 분석"->빅데이터분석 0.394로 대체로 0.48 아래.
# 반면 NCS에 없는 직무는 "창업"->창호시공 0.496, "간호사"->경호 0.597,
# "퀀트"->헤어미용 0.659로 그 위에 몰린다. 경계가 좁으니(0.48~0.50) 새 실측이
# 쌓이면 재조정할 것 — 느슨하게 잡느니 놓치는 편이 낫다(빈손이 안전한 기본값).
_EMBEDDING_MAX_DISTANCE = 0.48


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
    """임베딩 코사인 거리로 가까운 직무를 찾는다 (임계값 밖은 버린다).

    거리 필터가 없으면 항상 limit개를 채워 반환하므로 뒷 단계가 영영 실행되지 않고,
    NCS에 없는 직무에도 아무 행이나 붙는다. 임계값이 이 단계의 "모르겠다"이다.
    """
    query_vector = (await embed_texts([" ".join(terms)]))[0]
    distance = NcsJob.embedding.cosine_distance(query_vector)
    stmt = (
        select(NcsJob)
        .where(
            NcsJob.is_current.is_(True),
            NcsJob.embedding.is_not(None),
            distance < _EMBEDDING_MAX_DISTANCE,
        )
        .order_by(distance)
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
    """키워드로 NCS 직무 후보를 찾는다 (trgm → 임베딩 → ILIKE 순 폴백)."""
    terms = [k.strip() for k in keywords if k and k.strip()]
    if not terms:
        return []

    rows = await _shortlist_by_trgm(db, terms, limit)
    if rows:
        return rows

    if _embeddings_enabled():
        try:
            rows = await _shortlist_by_embedding(db, terms, limit)
            if rows:
                return rows
        except Exception:
            # 임베딩은 부가 정밀화일 뿐이라 실패해도 로드맵 생성을 막지 않는다.
            logger.warning("embedding shortlist failed; falling back to ILIKE", exc_info=True)

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
