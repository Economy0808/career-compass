from functools import lru_cache

from app.config import get_settings
from app.llm.base import LLMClient
from app.llm.mock_client import MockClaudeClient


@lru_cache
def get_llm_client() -> LLMClient:
    """LLM 클라이언트 factory.

    ANTHROPIC_API_KEY가 있고 test 환경이 아니면 실제 Claude 연동을,
    아니면 결정론적 Mock을 반환한다 (개발/테스트 $0). 다른 코드는
    LLMClient 인터페이스에만 의존한다.
    """
    settings = get_settings()
    if settings.use_real_llm:
        # 지연 import: 키가 없으면 anthropic SDK를 로드하지 않는다.
        from app.llm.anthropic_client import AnthropicClaudeClient

        return AnthropicClaudeClient()
    return MockClaudeClient()
