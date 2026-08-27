"""Firebase 에뮬레이터 테스트 전용 공용 헬퍼.

여러 테스트 파일(test_firebase_auth.py, test_auth_sync_api.py 등)이 "진짜 서명된
ID 토큰"을 발급받아야 하는데, 그 방법(커스텀 토큰 -> REST 교환)이 동일하므로
한 곳에 모아둔다 - 파일마다 복사하면 나중에 에뮬레이터 REST 경로가 바뀔 때
전부 따로 고쳐야 한다.
"""

from __future__ import annotations

import os

import requests
from firebase_admin import auth as fb_auth


def mint_id_token(uid: str) -> str:
    """에뮬레이터 전용: 커스텀 토큰을 만들고 REST로 교환해 진짜 서명된 ID 토큰을 얻는다.

    프로덕션에서는 클라이언트 SDK가 로그인 시 이 과정을 대신 해준다(비밀번호/OAuth
    로그인 -> ID 토큰). 서버 프로세스(Admin SDK)는 애초에 ID 토큰을 직접 발급할
    권한이 없으므로, 에뮬레이터가 제공하는 signInWithCustomToken(서명 검증을
    생략하는 비보안 경로 - 프로덕션 Auth에는 없다)을 빌려 Admin SDK가 만든 커스텀
    토큰을 진짜 ID 토큰으로 교환한다. 이렇게 얻은 ID 토큰은 verify_id_token이 실제
    운영 코드와 동일한 경로로 검증한다.
    """
    custom_token = fb_auth.create_custom_token(uid).decode("utf-8")
    host = os.environ["FIREBASE_AUTH_EMULATOR_HOST"]
    resp = requests.post(
        f"http://{host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken",
        params={"key": "fake-api-key"},
        json={"token": custom_token, "returnSecureToken": True},
        timeout=5,
    )
    resp.raise_for_status()
    id_token: str = resp.json()["idToken"]
    return id_token
