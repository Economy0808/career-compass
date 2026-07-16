import os

# 테스트는 절대 유료 API를 부르지 않는다: app_env=test면 팩토리가 Mock을 강제한다.
# (get_settings 최초 호출 전에 설정해야 하므로 import 최상단에서.)
os.environ.setdefault("APP_ENV", "test")

import pytest  # noqa: E402

from app.core import rate_limit  # noqa: E402
from app.db import reset_engine  # noqa: E402


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
