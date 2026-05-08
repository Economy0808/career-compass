import pytest

from app.db import reset_engine


@pytest.fixture(autouse=True)
async def _reset_db_engine():
    """매 테스트 후 DB engine을 dispose하여 다음 테스트가 새 engine을 만들도록 한다."""
    yield
    await reset_engine()