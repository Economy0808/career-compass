"""NCS 직무 매칭 3단 폴백 테스트 (pg_trgm → 임베딩 → ILIKE).

실제 Postgres(pgvector 이미지)를 쓰므로 cosine 정렬·trgm 유사도가 진짜로 실행된다.
임베딩 API는 절대 호출하지 않는다 — 벡터는 직접 심고 embed_texts는 monkeypatch한다.

**주의: 이 테스트는 실적재된 NCS(현행 직무 1,094개)와 같은 테이블을 공유한다.**
그래서 시드 행이 항상 1등이라고 단정하면 안 된다. 실데이터에 같은 이름의 직무가
있으면(예: "빅데이터분석") trgm 유사도가 동점이라 순위가 뒤집힌다 — 실제로 임베딩
백필이 행을 UPDATE하자 물리적 순서가 바뀌며 깨졌다. 검증 대상이 "어느 행"이 아니라
"어느 직무명"이므로, 동점이 가능한 곳은 code 대신 name으로 단언한다.
"""

import pytest
from sqlalchemy import delete, func, select

from app.db import get_session_factory
from app.models.ncs import EMBEDDING_DIM, NcsJob, NcsLclas, NcsMclas, NcsSclas
from app.services import ncs_repo

_LCLAS = "98"
_MCLAS = "9898"
_SCLAS = "989898"
_JOB_DATA = "9898JOB1"  # 빅데이터분석 - 띄어쓰기 변형 대상
_JOB_SW = "9898JOB2"  # 소프트웨어개발 - 약어 확장 대상
_JOB_FAR = "9898JOB3"  # 무관한 직무 - 폴백/거리 검증용


def _unit_vector(axis: int) -> list[float]:
    """지정한 축만 1인 단위 벡터 (코사인 거리 검증용)."""
    vector = [0.0] * EMBEDDING_DIM
    vector[axis] = 1.0
    return vector


@pytest.fixture
async def ncs_match_seed():
    """직무 매칭용 NCS 계층을 심고 정리한다 (FK 때문에 상위 계층 필수)."""
    async with get_session_factory()() as session:
        session.add(NcsLclas(code=_LCLAS, degree=1, name="정보통신", is_current=True))
        await session.flush()
        session.add(
            NcsMclas(code=_MCLAS, degree=1, lclas_code=_LCLAS, name="정보기술", is_current=True)
        )
        await session.flush()
        session.add(
            NcsSclas(code=_SCLAS, degree=1, mclas_code=_MCLAS, name="정보기술개발", is_current=True)
        )
        await session.flush()
        session.add_all(
            [
                NcsJob(
                    code=_JOB_DATA,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="빅데이터분석",
                    is_current=True,
                    embedding=_unit_vector(0),
                ),
                NcsJob(
                    code=_JOB_SW,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="소프트웨어개발",
                    is_current=True,
                    embedding=_unit_vector(1),
                ),
                NcsJob(
                    code=_JOB_FAR,
                    degree=1,
                    lclas_code=_LCLAS,
                    mclas_code=_MCLAS,
                    sclas_code=_SCLAS,
                    name="한복의장",
                    is_current=True,
                    embedding=None,
                ),
            ]
        )
        await session.commit()

    yield

    async with get_session_factory()() as s:
        await s.execute(delete(NcsJob).where(NcsJob.sclas_code == _SCLAS))
        await s.execute(delete(NcsSclas).where(NcsSclas.code == _SCLAS))
        await s.execute(delete(NcsMclas).where(NcsMclas.code == _MCLAS))
        await s.execute(delete(NcsLclas).where(NcsLclas.code == _LCLAS))
        await s.commit()


@pytest.mark.asyncio
async def test_trgm_matches_across_spacing(ncs_match_seed) -> None:
    """띄어쓰기 변형: '데이터 분석' -> '빅데이터분석' (ILIKE로는 못 잡던 케이스).

    실데이터에도 같은 이름의 직무가 있어 어느 행이 1등일지는 동점이다 — 직무명으로 본다.
    """
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["데이터 분석"])
    assert rows and rows[0].name == "빅데이터분석"


@pytest.mark.asyncio
async def test_trgm_expands_synonyms(ncs_match_seed) -> None:
    """약어 확장: 'SW 개발' -> '소프트웨어개발'."""
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["SW 개발"])
    assert rows and rows[0].code == _JOB_SW


@pytest.mark.asyncio
async def test_gibberish_keyword_matches_nothing(ncs_match_seed) -> None:
    """의미 없는 문자열은 trgm 임계값에도, ILIKE에도 걸리지 않는다.

    (직무명과 글자를 공유하는 키워드는 적재된 실제 NCS 직무에 느슨하게 매칭될 수
    있다 — 임계값의 목적은 완전한 소음을 거르는 것이지 정확도 보장이 아니다.)
    """
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["쿽쿽쿽뷁뷁뷁"])
    assert rows == []


@pytest.mark.asyncio
async def test_empty_keywords_short_circuit() -> None:
    async with get_session_factory()() as db:
        assert await ncs_repo.shortlist_jobs(db, ["", "   "]) == []


# trgm이 반드시 빈손인 질의. 임베딩 단계까지 내려보내려면 이런 입력이어야 한다
# (trgm이 먼저 잡아버리면 임베딩은 실행조차 되지 않는다).
_TRGM_MISS = "쿽쿽쿽뷁뷁뷁"


def _fake_embed(vector: list[float]):
    async def _embed(texts: list[str], **kwargs: object) -> list[list[float]]:
        return [vector]

    return _embed


@pytest.mark.asyncio
async def test_trgm_wins_before_embedding_is_tried(ncs_match_seed, monkeypatch) -> None:
    """trgm이 답을 내면 임베딩은 호출조차 되지 않는다 (정밀도 우선 순서 보장)."""
    monkeypatch.setattr(ncs_repo, "_embeddings_enabled", lambda: True)

    async def must_not_run(texts: list[str], **kwargs: object) -> list[list[float]]:
        raise AssertionError("trgm이 매칭했는데 임베딩이 호출됐다")

    monkeypatch.setattr(ncs_repo, "embed_texts", must_not_run)
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["데이터 분석"])
    assert rows and rows[0].name == "빅데이터분석"


@pytest.mark.asyncio
async def test_embedding_fills_gap_when_trgm_misses(ncs_match_seed, monkeypatch) -> None:
    """trgm이 빈손이면 임계값 안에 드는 임베딩 매칭이 그 자리를 메운다."""
    monkeypatch.setattr(ncs_repo, "_embeddings_enabled", lambda: True)
    # 축 1(소프트웨어개발)과 정확히 일치 -> 거리 0. 축 0(빅데이터분석)은 직교라 거리 1로
    # 임계값 밖이고, _JOB_FAR는 embedding이 NULL이라 애초에 후보가 아니다.
    monkeypatch.setattr(ncs_repo, "embed_texts", _fake_embed(_unit_vector(1)))
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, [_TRGM_MISS])
    assert [r.code for r in rows] == [_JOB_SW]


@pytest.mark.asyncio
async def test_embedding_rejects_distant_matches(ncs_match_seed, monkeypatch) -> None:
    """거리 임계값 밖이면 '가장 가까운 행'이 있어도 빈손을 반환한다.

    임계값이 없으면 임베딩은 항상 limit개를 채워 NCS에 없는 직무("창업")에도
    엉뚱한 행("창호시공")을 붙인다. 그라운딩이므로 빈손이 정답이다.
    """
    monkeypatch.setattr(ncs_repo, "_embeddings_enabled", lambda: True)
    # 심어둔 어떤 벡터와도 직교한 축 -> 모든 후보가 거리 1.0
    monkeypatch.setattr(ncs_repo, "embed_texts", _fake_embed(_unit_vector(7)))
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, [_TRGM_MISS])
    assert rows == []


@pytest.mark.asyncio
async def test_embedding_failure_degrades_gracefully(ncs_match_seed, monkeypatch) -> None:
    """임베딩 API가 죽어도 예외가 새지 않고 마지막 단계(ILIKE)로 넘어간다."""
    monkeypatch.setattr(ncs_repo, "_embeddings_enabled", lambda: True)

    async def boom(texts: list[str], **kwargs: object) -> list[list[float]]:
        raise RuntimeError("embedding service down")

    monkeypatch.setattr(ncs_repo, "embed_texts", boom)
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, [_TRGM_MISS])
    assert rows == []


@pytest.mark.asyncio
async def test_synonym_targets_exist_in_ncs() -> None:
    """동의어 대상은 전부 실제 NCS 직무명에 존재해야 한다.

    NCS에 없는 말로 보내는 매핑은 조용히 아무것도 안 한다 — 후보만 늘리고 매칭은
    0건이라 눈에 띄지 않는다. 실제로 HR->인적자원, UX->사용자경험, UI->사용자
    인터페이스, 엔지니어->공학 네 개가 그 상태로 방치돼 있었다.
    """
    async with get_session_factory()() as db:
        if not await db.scalar(select(func.count()).select_from(NcsJob)):
            pytest.skip("NCS 데이터가 적재되지 않은 환경")
        dead = [
            f"{src} -> {dst}"
            for src, dst in ncs_repo._SYNONYMS.items()
            if await db.scalar(
                select(NcsJob.name)
                .where(NcsJob.is_current.is_(True), NcsJob.name.ilike(f"%{dst}%"))
                .limit(1)
            )
            is None
        ]
    assert not dead, f"NCS 직무명에 존재하지 않는 동의어 대상: {dead}"


@pytest.mark.asyncio
async def test_defaults_to_trgm_without_key(ncs_match_seed) -> None:
    """키가 없는 기본 상태(app_env=test)에선 임베딩을 시도조차 하지 않는다."""
    assert ncs_repo._embeddings_enabled() is False
    async with get_session_factory()() as db:
        rows = await ncs_repo.shortlist_jobs(db, ["빅데이터분석"])
    assert rows and rows[0].name == "빅데이터분석"
