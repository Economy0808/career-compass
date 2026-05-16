"""NCS ETL 함수 단위 테스트.

DB와 외부 API는 모두 mock 처리한다.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.etl.ncs_ingest import (
    _assert_fields,
    ingest_ncs_ability_unit,
    ingest_ncs_job,
    ingest_ncs_lclas,
    ingest_ncs_mclas,
    ingest_ncs_sclas,
)

# ---------------------------------------------------------------------------
# 픽스처 데이터
# ---------------------------------------------------------------------------

_LCLAS_ITEM = {
    "NCS_LCLAS_CD": "01",
    "NCS_DEGR": "24",
    "NCS_LCLAS_CDNM": "사업관리",
    "USG_YN": "Y",
}
_MCLAS_ITEM = {
    "NCS_MCLAS_CD": "0101",
    "NCS_MCLAS_CDNM": "프로젝트관리",
    "NCS_LCLAS_CD": "01",
    "NCS_DEGR": "24",
    "USG_YN": "Y",
}
_SCLAS_ITEM = {
    "NCS_SCLAS_CD": "010101",
    "NCS_SCLAS_CDNM": "PM/PL",
    "NCS_MCLAS_CD": "0101",
    "NCS_DEGR": "24",
    "USG_YN": "Y",
}
_JOB_ITEM = {
    "NCS_CD": "01010101",
    "NCS_CDNM": "프로젝트관리자",
    "NCS_SCLAS_CD": "010101",
    "NCS_DEGR": "24",
    "USG_YN": "Y",
}
_ABILITY_UNIT_ITEM = {
    "NCS_ABLTY_UNIT_CD": "0101010101_24v1",
    "NCS_ABLTY_UNIT_CDNM": "프로젝트 범위관리",
    "NCS_CD": "01010101",
    "NCS_DEGR": "24",
    "USG_YN": "Y",
}


def _raw(item: dict) -> dict:
    """단일 item을 probe용 raw JSON 응답 구조로 감싼다."""
    return {"response": {"body": {"items": {"item": item}, "totalCount": 1}}}


def _select_result(rows: list) -> MagicMock:
    """session.execute() 반환값 mock — .all()이 rows를 돌려준다."""
    m = MagicMock()
    m.all.return_value = rows
    return m


# ---------------------------------------------------------------------------
# _assert_fields
# ---------------------------------------------------------------------------


def test_assert_fields_passes(capsys):
    _assert_fields(_raw(_MCLAS_ITEM), ["NCS_MCLAS_CD", "NCS_MCLAS_CDNM"], "NCS002")
    assert "필드 검증 통과" in capsys.readouterr().out


def test_assert_fields_raises_on_missing_field():
    with pytest.raises(RuntimeError, match="필드명 불일치"):
        _assert_fields(_raw({"WRONG": "x"}), ["NCS_MCLAS_CD"], "NCS002")


def test_assert_fields_raises_on_empty_items():
    raw = {"response": {"body": {"items": {}, "totalCount": 0}}}
    with pytest.raises(RuntimeError, match="item이 없습니다"):
        _assert_fields(raw, ["NCS_MCLAS_CD"], "NCS002")


# ---------------------------------------------------------------------------
# ingest_ncs_lclas
# ---------------------------------------------------------------------------


async def test_ingest_ncs_lclas_happy_path():
    session = AsyncMock()
    with patch("app.etl.ncs_ingest.fetch_ncs_lclas", return_value=[_LCLAS_ITEM]):
        result = await ingest_ncs_lclas(session)

    assert result == {"fetched": 1, "upserted": 1}
    session.commit.assert_called_once()


async def test_ingest_ncs_lclas_empty_response():
    session = AsyncMock()
    with patch("app.etl.ncs_ingest.fetch_ncs_lclas", return_value=[]):
        result = await ingest_ncs_lclas(session)

    assert result == {"fetched": 0, "upserted": 0}
    session.commit.assert_called_once()


# ---------------------------------------------------------------------------
# ingest_ncs_mclas
# ---------------------------------------------------------------------------


async def test_ingest_ncs_mclas_happy_path():
    session = AsyncMock()
    session.execute.return_value = _select_result([("01",)])

    with (
        patch("app.etl.ncs_ingest._probe_raw", return_value=_raw(_MCLAS_ITEM)),
        patch("app.etl.ncs_ingest.fetch_ncs_mclas", return_value=[_MCLAS_ITEM]),
        patch("app.etl.ncs_ingest.asyncio.sleep"),
    ):
        result = await ingest_ncs_mclas(session)

    assert result == {"fetched": 1, "upserted": 1}
    session.commit.assert_called_once()


async def test_ingest_ncs_mclas_empty_parent():
    session = AsyncMock()
    session.execute.return_value = _select_result([])

    with patch("app.etl.ncs_ingest._probe_raw") as mock_probe:
        result = await ingest_ncs_mclas(session)

    assert result == {"fetched": 0, "upserted": 0}
    mock_probe.assert_not_called()
    session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# ingest_ncs_sclas
# ---------------------------------------------------------------------------


async def test_ingest_ncs_sclas_happy_path():
    session = AsyncMock()
    session.execute.return_value = _select_result([("01", "0101")])

    with (
        patch("app.etl.ncs_ingest._probe_raw", return_value=_raw(_SCLAS_ITEM)),
        patch("app.etl.ncs_ingest.fetch_ncs_sclas", return_value=[_SCLAS_ITEM]),
        patch("app.etl.ncs_ingest.asyncio.sleep"),
    ):
        result = await ingest_ncs_sclas(session)

    assert result == {"fetched": 1, "upserted": 1}
    session.commit.assert_called_once()


async def test_ingest_ncs_sclas_empty_parent():
    session = AsyncMock()
    session.execute.return_value = _select_result([])

    with patch("app.etl.ncs_ingest._probe_raw") as mock_probe:
        result = await ingest_ncs_sclas(session)

    assert result == {"fetched": 0, "upserted": 0}
    mock_probe.assert_not_called()
    session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# ingest_ncs_job
# ---------------------------------------------------------------------------


async def test_ingest_ncs_job_happy_path():
    session = AsyncMock()
    session.execute.return_value = _select_result([("010101",)])

    with (
        patch("app.etl.ncs_ingest._probe_raw", return_value=_raw(_JOB_ITEM)),
        patch("app.etl.ncs_ingest.fetch_ncs_job", return_value=[_JOB_ITEM]),
        patch("app.etl.ncs_ingest.asyncio.sleep"),
    ):
        result = await ingest_ncs_job(session)

    assert result == {"fetched": 1, "upserted": 1}
    session.commit.assert_called_once()


async def test_ingest_ncs_job_empty_parent():
    session = AsyncMock()
    session.execute.return_value = _select_result([])

    with patch("app.etl.ncs_ingest._probe_raw") as mock_probe:
        result = await ingest_ncs_job(session)

    assert result == {"fetched": 0, "upserted": 0}
    mock_probe.assert_not_called()
    session.commit.assert_not_called()


# ---------------------------------------------------------------------------
# ingest_ncs_ability_unit
# ---------------------------------------------------------------------------


async def test_ingest_ncs_ability_unit_happy_path():
    session = AsyncMock()
    session.execute.return_value = _select_result([("01010101",)])

    with (
        patch("app.etl.ncs_ingest._probe_raw", return_value=_raw(_ABILITY_UNIT_ITEM)),
        patch("app.etl.ncs_ingest.fetch_ncs_ability_unit", return_value=[_ABILITY_UNIT_ITEM]),
        patch("app.etl.ncs_ingest.asyncio.sleep"),
    ):
        result = await ingest_ncs_ability_unit(session)

    assert result == {"fetched": 1, "upserted": 1}
    session.commit.assert_called_once()


async def test_ingest_ncs_ability_unit_empty_parent():
    session = AsyncMock()
    session.execute.return_value = _select_result([])

    with patch("app.etl.ncs_ingest._probe_raw") as mock_probe:
        result = await ingest_ncs_ability_unit(session)

    assert result == {"fetched": 0, "upserted": 0}
    mock_probe.assert_not_called()
    session.commit.assert_not_called()
