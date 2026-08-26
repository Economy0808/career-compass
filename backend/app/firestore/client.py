"""Firestore 클라이언트 초기화.

backend/app/db.py의 SQLAlchemy 엔진과 동일한 이유로 지연 초기화(lazy init)한다:
모듈 임포트 시점에 클라이언트를 만들면 pytest 프로세스마다 다른 이벤트 루프/환경
변수를 전제로 하게 되어 테스트 격리가 깨진다. firebase_admin은 프로세스당 앱을
하나만 등록할 수 있으므로(재초기화 시 ValueError), get_firestore_client()가
최초 호출될 때만 초기화하고 이후에는 캐시된 인스턴스를 재사용한다. reset_client()는
db.py의 reset_engine()과 대응되는 테스트 전용 훅이다.

에뮬레이터 관련 주의사항 (브리핑에서 다루지 않은 실제 함정, report에도 기술):
google-cloud-firestore의 Client는 FIRESTORE_EMULATOR_HOST가 설정돼 있고
credentials가 None일 때만 AnonymousCredentials로 자동 대체한다. 그런데
firebase_admin은 내부적으로 항상 App.credential.get_credential()이 반환한
"실제" 자격 증명 객체를 명시적으로 Client에 넘긴다 (None을 넘기는 경로가 없다) -
즉 firebase_admin.credentials.ApplicationDefault()를 쓰면 로컬/CI에 GCP
Application Default Credentials가 없을 때 DefaultCredentialsError로 죽어버리고,
에뮬레이터 자동 감지는 전혀 발동하지 않는다. 그래서 에뮬레이터 환경에서는
아래 _EmulatorCredential로 명시적으로 우회한다.
"""

from __future__ import annotations

import os

import firebase_admin
from firebase_admin import credentials, firestore
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore import Client

_FIRESTORE_EMULATOR_HOST_ENV = "FIRESTORE_EMULATOR_HOST"
_PROJECT_ID_ENV = "FIRESTORE_PROJECT_ID"
_DEFAULT_PROJECT_ID = "demo-ourlab"

_client: Client | None = None


class _EmulatorCredential(credentials.Base):
    """에뮬레이터 전용 자격 증명.

    firebase_admin이 항상 명시적인 자격 증명 객체를 Firestore Client에 넘기기
    때문에, 실제 GCP 인증(ApplicationDefault)을 아예 건너뛰고 익명 자격 증명을
    직접 반환한다. 프로덕션 경로(Cloud Run)에서는 절대 쓰이지 않는다 -
    FIRESTORE_EMULATOR_HOST가 설정된 로컬/테스트 환경에서만 선택된다.
    """

    def get_credential(self) -> AnonymousCredentials:
        return AnonymousCredentials()


def _resolve_project_id() -> str:
    """Firestore 프로젝트 id를 환경변수에서 가져오고, 없으면 데모 기본값을 쓴다.

    안전을 위해 기본값은 항상 데모/에뮬레이터 프로젝트다 - 실제 운영 프로젝트
    (ourlab-0808)는 배포 환경에서 명시적으로 환경변수를 설정해야만 쓰인다.
    """
    return (
        os.environ.get(_PROJECT_ID_ENV)
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or os.environ.get("GCLOUD_PROJECT")
        or _DEFAULT_PROJECT_ID
    )


def _build_credential() -> credentials.Base:
    if os.environ.get(_FIRESTORE_EMULATOR_HOST_ENV):
        return _EmulatorCredential()
    return credentials.ApplicationDefault()


def get_firestore_client() -> Client:
    """캐시된 Firestore 클라이언트를 반환하고, 없으면 최초 1회 초기화한다."""
    global _client
    if _client is not None:
        return _client

    try:
        app = firebase_admin.get_app()
    except ValueError:
        app = firebase_admin.initialize_app(
            _build_credential(), options={"projectId": _resolve_project_id()}
        )

    _client = firestore.client(app)
    return _client


def reset_client() -> None:
    """테스트용: 캐시된 클라이언트와 firebase_admin 앱을 정리한다.

    db.py의 reset_engine()과 동일한 역할 - 각 테스트가 끝날 때 호출해 다음
    테스트가 새 클라이언트/앱으로 시작하도록 한다 (프로젝트 id나 에뮬레이터
    host가 테스트 간에 달라져도 이전 상태가 새어나가지 않는다).
    """
    global _client
    try:
        app = firebase_admin.get_app()
    except ValueError:
        app = None
    if app is not None:
        firebase_admin.delete_app(app)
    _client = None
