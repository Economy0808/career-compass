"""/api/profiles 요청/응답 스키마.

app/schemas/auth_sync.py와 동일한 `_CamelModel` 관례(alias_generator=to_camel
+ populate_by_name=True)를 따른다 - 프론트엔드는 camelCase JSON을 기대한다.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

_MAX_BIO_LEN = 500
_MAX_DECLARED_TAG_LEN = 20
_MAX_CAREER_TEXT_LEN = 1000
_STUDENT_ID_PATTERN = r"^\d{10}$"


class _CamelModel(BaseModel):
    """camelCase 와이어 포맷 + snake_case 파이썬 필드명을 함께 쓰는 기본 모델."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ProfilePatchIn(_CamelModel):
    """본인 프로필 부분 갱신 요청. None인 필드는 건드리지 않는다."""

    display_name: str | None = Field(default=None, max_length=40)
    avatar_emoji: str | None = Field(default=None, max_length=8)
    bio: str | None = Field(default=None, max_length=_MAX_BIO_LEN)


class ProfileOut(_CamelModel):
    """공개 프로필 응답.

    is_following은 요청자가 로그인했고 본인 프로필이 아닐 때만 값이 채워진다
    (그 외에는 None) - 라우터가 response_model_exclude_none=True를 켜므로 그
    경우 키 자체가 응답에서 빠진다.
    """

    uid: str
    display_name: str | None = None
    avatar_emoji: str | None = None
    bio: str | None = None
    follower_count: int = 0
    following_count: int = 0
    is_following: bool | None = None


class OnboardingConsentsIn(_CamelModel):
    """가입 온보딩 동의 항목.

    service(서비스 이용약관)가 필수 - False면 422로 막는다. marketing(마케팅 정보
    수신)은 선택이라 기본값 False.

    개인정보 국외이전(overseas) 동의는 여기서 받지 않는다(2026-09-04 사용자 결정):
    온보딩 데이터(학번·학과·career_text)는 국내(Vertex asia-northeast3)에만
    저장되고 Anthropic으로 가지 않으므로, 국외이전 동의는 실제 이전이 일어나는
    인테이크 대화 진입 시점에서 별도로 받는다(아직 안 일어난 이전에 대한 선동의를
    프로필 화면에서 받는 어색함 방지).
    """

    service: bool
    marketing: bool = False


class ProfileOnboardingIn(_CamelModel):
    """가입 직후 확장 프로필 온보딩 요청.

    민감도별로 3개 목적지(users/user_private/student_verifications)에 나뉘어
    저장된다 - 라우터(app/api/profiles.py의 POST /onboarding) 참고. 여기서는
    와이어 형태만 검증한다 - declared_tags 트림/중복제거/재검증 같은 비즈니스
    로직은 라우터가 담당한다(스키마 검증은 원시 입력 형태만 본다).
    """

    student_id: str = Field(pattern=_STUDENT_ID_PATTERN)
    department: str = Field(max_length=40)
    double_major: str | None = Field(default=None, max_length=40)
    grade: int = Field(ge=1, le=6)
    declared_tags: list[Annotated[str, Field(max_length=_MAX_DECLARED_TAG_LEN)]] = Field(
        min_length=1, max_length=10
    )
    career_text: str | None = Field(default=None, max_length=_MAX_CAREER_TEXT_LEN)
    consents: OnboardingConsentsIn


class ProfileOnboardingOut(ProfileOut):
    """온보딩 완료 응답 - 공개 프로필(ProfileOut)에 완료 플래그만 얹는다."""

    onboarding_complete: bool


class OnboardingStatusOut(_CamelModel):
    """본인 온보딩 완료 여부 + 저장된 학과를 담는 경량 응답(GET /me/onboarding).

    프론트가 로그인 직후 조회해 false면 /onboarding으로 라우팅한다(계정만 만들고
    온보딩 미완인 limbo 유저 방지). user_private 문서 존재로 판정한다.

    department는 프론트의 학과 선택 UI 사전 선택용(fast-follow) - 온보딩 미완이면
    None이다. 신규 Firestore 조회 없이 기존 user_private 읽기 결과를 그대로 얹는다.
    """

    onboarding_complete: bool
    department: str | None = None
