from app.llm.base import LLMClient
from app.llm.mock_client import MockClaudeClient


def get_llm_client() -> LLMClient:
    """LLM 클라이언트 factory.

    실제 Claude 연동이 준비되면 (anthropic SDK + ANTHROPIC_API_KEY) 이 함수만
    실제 구현체로 교체하면 된다. 다른 코드는 LLMClient 인터페이스에만 의존한다.
    """
    return MockClaudeClient()
