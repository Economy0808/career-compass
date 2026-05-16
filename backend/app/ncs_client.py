"""
data.go.kr NCS 기준정보 조회 API 클라이언트.

API 페이지: https://www.data.go.kr/data/15128213/openapi.do
오퍼레이션:
  - NCS001: NCS 대분류 코드 조회
  - NCS002: NCS 중분류 코드 조회 (NCS_LCLAS_CD 필수)
  - NCS003: NCS 소분류 코드 조회 (NCS_LCLAS_CD, NCS_MCLAS_CD 필수)
  - NCS004: NCS 세분류(직무) 코드 조회 (NCS_SCLAS_CD 필수, 가정)
  - NCS005: NCS 능력단위분류코드 조회 (NCS_CD 필수, 가정)
  - NCS006: NCS 능력단위요소 조회
  - NCS007: NCS 능력단위키워드 검색
"""

import asyncio

import httpx

from app.config import get_settings

NCS_BASE_URL = "https://apis.data.go.kr/B490007/hrdkapi"
_PAGE_SIZE = 100


async def _fetch_all_pages(url: str, extra_params: dict) -> list[dict]:
    """totalCount 기반으로 전 페이지를 순회해 items를 하나의 list로 반환한다.

    페이지 간 0.1초 대기. 호출 실패 시 0.5초 후 1회 재시도.
    """
    settings = get_settings()
    base_params = {
        "serviceKey": settings.data_go_kr_api_key,
        "_type": "json",
        "numOfRows": str(_PAGE_SIZE),
        **extra_params,
    }

    all_items: list[dict] = []
    page = 1
    while True:
        page_params = {**base_params, "pageNo": str(page)}
        for attempt in range(2):
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(url, params=page_params)
                    resp.raise_for_status()
                    data = resp.json()
                break
            except Exception:
                if attempt == 1:
                    raise
                await asyncio.sleep(0.5)

        body = data.get("response", {}).get("body", {})
        items = body.get("items", {}).get("item", [])
        if isinstance(items, dict):
            items = [items]
        all_items.extend(items)

        total_count = int(body.get("totalCount", 0))
        if page * _PAGE_SIZE >= total_count:
            break
        page += 1
        await asyncio.sleep(0.1)

    return all_items


async def fetch_ncs_lclas() -> list[dict]:
    """NCS 대분류 코드를 전 페이지 조회한다 (NCS001)."""
    return await _fetch_all_pages(f"{NCS_BASE_URL}/NCS001", {})


async def fetch_ncs_mclas(lclas_cd: str) -> list[dict]:
    """NCS 중분류 코드를 조회한다 (NCS002). NCS_LCLAS_CD 필수."""
    return await _fetch_all_pages(
        f"{NCS_BASE_URL}/NCS002",
        {"NCS_LCLAS_CD": lclas_cd},
    )


async def fetch_ncs_sclas(lclas_cd: str, mclas_cd: str) -> list[dict]:
    """NCS 소분류 코드를 조회한다 (NCS003). NCS_LCLAS_CD + NCS_MCLAS_CD 필수."""
    return await _fetch_all_pages(
        f"{NCS_BASE_URL}/NCS003",
        {"NCS_LCLAS_CD": lclas_cd, "NCS_MCLAS_CD": mclas_cd},
    )


async def fetch_ncs_job(sclas_cd: str) -> list[dict]:
    """NCS 세분류(직무) 코드를 조회한다 (NCS004). NCS_SCLAS_CD 필수 (가정)."""
    return await _fetch_all_pages(
        f"{NCS_BASE_URL}/NCS004",
        {"NCS_SCLAS_CD": sclas_cd},
    )


async def fetch_ncs_ability_unit(ncs_cd: str) -> list[dict]:
    """NCS 능력단위 코드를 조회한다 (NCS005). NCS_CD 필수 (가정)."""
    return await _fetch_all_pages(
        f"{NCS_BASE_URL}/NCS005",
        {"NCS_CD": ncs_cd},
    )
