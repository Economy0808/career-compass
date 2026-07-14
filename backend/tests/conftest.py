import pytest

from app.core import rate_limit
from app.db import reset_engine


@pytest.fixture(autouse=True)
async def _reset_db_engine():
    """매 테스트 후 DB engine을 dispose하여 다음 테스트가 새 engine을 만들도록 한다."""
    yield
    await reset_engine()


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """인메모리 레이트리미터가 테스트 간에 새어나가지 않도록 초기화."""
    rate_limit.reset()
    yield
    rate_limit.reset()
