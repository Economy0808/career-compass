"""Vertex AI gemini-embedding-001 REST 클라이언트.

app/email/resend_sender.py를 복제 템플릿으로 삼는다 - 이 엔드포인트도 호출 하나뿐
이라 google-cloud-aiplatform SDK를 새로 추가할 이유가 없다(이미 런타임에 있는
httpx + google-auth만으로 충분하다).

인증은 API 키가 아니라 Google ADC(Application Default Credentials)다. 운영
(Cloud Run)에서는 access_token을 넘기지 않고 google.auth.default()가 서비스
계정 자격 증명을 자동으로 찾는다. scripts/backfill_profile_embeddings.py 같은
로컬 백필 스크립트는 `gcloud auth print-access-token`으로 얻은 토큰을
access_token으로 직접 주입한다(로컬 환경에 ADC가 없어도 되게).

컴플라이언스(PIPA): 본문(사용자 소개/목표 텍스트)은 어떤 레벨에서도 로그에
남기지 않는다 - 실패 로그에는 텍스트 길이와 상태 코드만 남긴다.
"""

import logging

import httpx
from google.auth.exceptions import DefaultCredentialsError

from app.config import Settings, get_settings
from app.embedding.base import EmbeddingError, EmbeddingKind
from app.firestore.client import _resolve_project_id

logger = logging.getLogger("app.embedding")

_MAX_ATTEMPTS = 2  # 최초 1회 + 일시적 실패 시 재시도 1회
_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
_TASK_TYPES: dict[EmbeddingKind, str] = {
    "query": "RETRIEVAL_QUERY",
    "document": "RETRIEVAL_DOCUMENT",
}


class VertexEmbeddingClient:
    """Vertex AI predict 엔드포인트로 텍스트 한 건을 임베딩한다."""

    def __init__(
        self,
        *,
        settings: Settings | None = None,
        client: httpx.AsyncClient | None = None,
        access_token: str | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        # 주입된 클라이언트는 호출측 소유 - 여기서 닫지 않는다 (테스트용).
        self._client = client
        # 백필 스크립트가 gcloud 토큰을 직접 주입할 때 쓴다. 운영 경로에서는 None -
        # google.auth.default()로 매 요청 자동 갱신한다.
        self._access_token = access_token
        self._cached_credentials: object | None = None

    def _url(self) -> str:
        location = self._settings.embedding_location
        project = _resolve_project_id()
        model = self._settings.embedding_model
        return (
            f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/"
            f"locations/{location}/publishers/google/models/{model}:predict"
        )

    def _get_access_token(self) -> str:
        if self._access_token is not None:
            return self._access_token
        try:
            import google.auth
            import google.auth.transport.requests

            if self._cached_credentials is None:
                credentials, _ = google.auth.default(scopes=_SCOPES)
                self._cached_credentials = credentials
            credentials = self._cached_credentials
            if not credentials.valid:  # type: ignore[union-attr]
                credentials.refresh(google.auth.transport.requests.Request())  # type: ignore[union-attr]
            return credentials.token  # type: ignore[union-attr,no-any-return]
        except DefaultCredentialsError as exc:
            raise EmbeddingError(f"Vertex 인증 실패: {exc}") from exc

    async def embed(self, text: str, *, kind: EmbeddingKind) -> list[float]:
        project = _resolve_project_id()
        body = {
            "instances": [{"content": text, "task_type": _TASK_TYPES[kind]}],
            "parameters": {
                "outputDimensionality": self._settings.embedding_dimensions,
                "autoTruncate": True,
            },
        }
        headers = {
            "Authorization": f"Bearer {self._get_access_token()}",
            "x-goog-user-project": project,
            "Content-Type": "application/json",
        }
        url = self._url()

        last_error: str = "unknown"
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            try:
                response = await self._post(url, body, headers)
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                logger.warning(
                    "임베딩 요청 연결 실패 (attempt %d/%d) len=%d: %s",
                    attempt,
                    _MAX_ATTEMPTS,
                    len(text),
                    last_error,
                )
                continue

            if response.status_code < 300:
                return self._parse(response)

            last_error = f"HTTP {response.status_code}"
            retryable = response.status_code >= 500 or response.status_code == 429
            logger.warning(
                "임베딩 요청 실패 (attempt %d/%d) len=%d status=%d",
                attempt,
                _MAX_ATTEMPTS,
                len(text),
                response.status_code,
            )
            if not retryable:
                break

        raise EmbeddingError(f"Vertex 임베딩 실패: {last_error}")

    async def _post(self, url: str, body: dict, headers: dict) -> httpx.Response:
        if self._client is not None:
            return await self._client.post(url, json=body, headers=headers)
        timeout = httpx.Timeout(self._settings.embedding_timeout_sec, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.post(url, json=body, headers=headers)

    def _parse(self, response: httpx.Response) -> list[float]:
        data = response.json()
        try:
            values = data["predictions"][0]["embeddings"]["values"]
        except (KeyError, IndexError, TypeError) as exc:
            raise EmbeddingError("Vertex 응답 형식이 예상과 다릅니다.") from exc
        if len(values) != self._settings.embedding_dimensions:
            raise EmbeddingError(
                f"Vertex 응답 차원 불일치: 기대 {self._settings.embedding_dimensions}, "
                f"실제 {len(values)}"
            )
        return [float(v) for v in values]
