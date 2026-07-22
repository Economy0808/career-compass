import os

# 테스트는 절대 유료 API를 부르지 않는다: app_env=test면 팩토리가 Mock을 강제한다.
# (get_settings 최초 호출 전에 설정해야 하므로 import 최상단에서.)
os.environ.setdefault("APP_ENV", "test")

# asyncpg + Windows + Python 3.14는 인터프리터 종료 시 이벤트 루프가 사라진 뒤
# 커넥션을 finalize하다 세그폴트(exit 139)를 낼 수 있다 — 전체 스윗에서만, 그리고
# 모든 테스트가 통과한 "뒤" 종료 단계에서. numpy가 로드돼 있으면 C 확장 finalizer
# 순서가 바뀌어 이 크래시가 사라진다. 예전엔 pgvector가 numpy를 전이 의존으로 끌어와
# 무마됐는데, ncs_job.embedding 컬럼을 지우며 pgvector import가 빠져 잠복 크래시가
# 드러났다. 근본 해결은 CLAUDE.md가 적어둔 per-test 트랜잭션 롤백 픽스처 이관이고,
# 이 프리로드는 그 전까지 스윗 exit code를 0으로 유지하는 임시 방편이다.
import numpy  # noqa: E402,F401
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
