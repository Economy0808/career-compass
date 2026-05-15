"""
data.go.kr NCS 기준정보 조회 API 클라이언트.

API 페이지: https://www.data.go.kr/data/15128213/openapi.do
오퍼레이션:
  - NCS001: NCS 대분류 코드 조회
  - NCS002: NCS 중분류 코드 조회 (NCS_LCLAS_CD 필수)
  - NCS003: NCS 소분류 코드 조회 (NCS_LCLAS_CD, NCS_MCLAS_CD 필수)
  - NCS004: NCS 세분류(직무) 코드 조회
  - NCS005: NCS 능력단위분류코드 조회
  - NCS006: NCS 능력단위요소 조회
  - NCS007: NCS 능력단위키워드 검색
"""
import httpx

from app.config import get_settings

NCS_BASE_URL = "https://apis.data.go.kr/B490007/hrdkapi"


async def fetch_ncs_lclas() -> dict:
    """NCS 대분류 코드를 조회한다 (NCS001).

    Returns:
        API 원본 응답 dict.
    """
    settings = get_settings()
    params = {
        "serviceKey": settings.data_go_kr_api_key,
        "pageNo": "1",
        "numOfRows": "100",
        "_type": "json",
    }
    url = f"{NCS_BASE_URL}/NCS001"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()