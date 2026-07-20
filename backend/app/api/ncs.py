"""NCS 분류 조회 API (씨앗 심기에서 유저가 분야를 고르는 데 쓴다).

공개 데이터(국가직무능력표준 분류 체계)라 인증 없이 열람 가능하다.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.roadmap import NcsCategoryOut
from app.services import ncs_repo

router = APIRouter(prefix="/api/ncs", tags=["ncs"])


@router.get("/categories", response_model=list[NcsCategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)) -> list[NcsCategoryOut]:
    """NCS 대분류 목록 (직무가 있는 것만, 직무 수 많은 순).

    유저가 여기서 분야를 고르면 preview가 그 안에서만 직무를 판정한다 —
    후보가 1,094개에서 평균 46개로 줄어 정확도와 비용이 함께 좋아진다.
    """
    options = await ncs_repo.list_lclas(db)
    return [NcsCategoryOut(code=o.code, name=o.name, job_count=o.job_count) for o in options]
