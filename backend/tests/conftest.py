import contextlib
import os

# 테스트는 절대 유료 API를 부르지 않는다: app_env=test면 팩토리가 Mock을 강제한다.
# (get_settings 최초 호출 전에 설정해야 하므로 import 최상단에서.)
os.environ.setdefault("APP_ENV", "test")

# 테스트는 절대 실데이터 프로젝트(demo-ourlab)를 건드리지 않는다: 아래
# _reset_firestore_emulator / _reset_auth_emulator 픽스처가 매 테스트 후 프로젝트
# 전체를 REST로 지우는데, 에뮬레이터를 켜둔 채 pytest를 돌리면 course_catalog
# 7천여 건까지 통째로 날아갔다(2026-08-30 실사고). setdefault가 아닌 강제 대입 -
# 셸에 demo-ourlab이 export돼 있어도 테스트가 실데이터를 지우는 일이 없어야 한다.
# (에뮬레이터 singleProjectMode는 경고만 낼 뿐 별도 프로젝트 쓰기를 막지 않는다.)
os.environ["FIRESTORE_PROJECT_ID"] = "demo-ourlab-test"

# asyncpg + Windows + Python 3.14는 인터프리터 종료 시 이벤트 루프가 사라진 뒤
# 커넥션을 finalize하다 세그폴트(exit 139)를 낼 수 있다 — 전체 스윗에서만, 그리고
# 모든 테스트가 통과한 "뒤" 종료 단계에서. numpy가 로드돼 있으면 C 확장 finalizer
# 순서가 바뀌어 이 크래시가 사라진다. 예전엔 pgvector가 numpy를 전이 의존으로 끌어와
# 무마됐는데, ncs_job.embedding 컬럼을 지우며 pgvector import가 빠져 잠복 크래시가
# 드러났다. 근본 해결은 CLAUDE.md가 적어둔 per-test 트랜잭션 롤백 픽스처 이관이고,
# 이 프리로드는 그 전까지 스윗 exit code를 0으로 유지하는 임시 방편이다.
import numpy  # noqa: E402,F401
import pytest  # noqa: E402
import requests  # noqa: E402

from app.core import rate_limit  # noqa: E402
from app.db import reset_engine  # noqa: E402
from app.firestore.client import reset_client as reset_firestore_client  # noqa: E402


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


@pytest.fixture(autouse=True)
def _reset_firestore_emulator():
    """Firestore 에뮬레이터 데이터와 캐시된 클라이언트를 매 테스트 후 초기화한다.

    FIRESTORE_EMULATOR_HOST가 설정되지 않은 대부분의 로컬/CI 실행(이 스위트의
    나머지 테스트는 Firestore를 전혀 쓰지 않는다)에서는 조용히 아무 것도 하지
    않는다 - 에뮬레이터 부재가 이 프로젝트의 기존 테스트를 실패시키면 안 된다.
    """
    yield
    reset_firestore_client()
    emulator_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not emulator_host:
        return
    project_id = os.environ.get("FIRESTORE_PROJECT_ID", "demo-ourlab")
    url = f"http://{emulator_host}/emulator/v1/projects/{project_id}/databases/(default)/documents"
    with contextlib.suppress(requests.exceptions.RequestException):
        requests.delete(url, timeout=5)


@pytest.fixture(autouse=True)
def _reset_auth_emulator():
    """Auth 에뮬레이터에 테스트가 만든 유저/커스텀 클레임이 다음 테스트로 새어나가지
    않도록 정리한다.

    _reset_firestore_emulator와 동일한 이유로, FIREBASE_AUTH_EMULATOR_HOST가 설정되지
    않은 대부분의 로컬/CI 실행(Firebase Auth를 전혀 쓰지 않는 나머지 테스트)에서는
    조용히 아무 것도 하지 않는다. firebase_admin 앱 자체의 해체는
    _reset_firestore_emulator(reset_client 호출)가 이미 담당하므로 여기서는 건드리지
    않는다 - 이 픽스처는 순수 REST 호출로 에뮬레이터가 들고 있는 계정 데이터만
    지운다.
    """
    yield
    emulator_host = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST")
    if not emulator_host:
        return
    project_id = os.environ.get("FIRESTORE_PROJECT_ID", "demo-ourlab")
    url = f"http://{emulator_host}/emulator/v1/projects/{project_id}/accounts"
    with contextlib.suppress(requests.exceptions.RequestException):
        requests.delete(url, timeout=5)
