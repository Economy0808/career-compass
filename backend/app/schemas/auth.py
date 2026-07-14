"""인증 API 요청/응답 스키마. 모든 입력은 Pydantic으로 형식·길이를 강제한다."""
from pydantic import BaseModel, EmailStr, Field, field_validator

YONSEI_DOMAIN = "@yonsei.ac.kr"


class SignupRequest(BaseModel):
    username: str = Field(pattern=r"^[a-z0-9_]{4,20}$")
    password: str = Field(min_length=8, max_length=128)
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=30)
    avatar_emoji: str = Field(default="🌱", min_length=1, max_length=8)
    consent: bool

    @field_validator("consent")
    @classmethod
    def consent_required(cls, v: bool) -> bool:
        # PIPA: 개인정보 수집·이용 동의 없이는 가입 자체가 불가.
        if not v:
            raise ValueError("개인정보 수집·이용에 동의해야 가입할 수 있습니다.")
        return v

    @field_validator("password")
    @classmethod
    def password_not_username_like(cls, v: str) -> str:
        if v.isdigit() or v.isalpha():
            raise ValueError("비밀번호는 문자와 숫자를 섞어 8자 이상이어야 합니다.")
        return v


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=128)


class SchoolEmailRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def must_be_yonsei(cls, v: str) -> str:
        if not v.lower().endswith(YONSEI_DOMAIN):
            raise ValueError("연세대 학교 이메일(@yonsei.ac.kr)만 사용할 수 있습니다.")
        return v


class SchoolEmailVerifyRequest(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class MeOut(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_emoji: str
    email: str
    email_verified: bool
    yonsei_verified: bool
    verification_method: str | None
    card_status: str | None  # "pending" | "approved" | "rejected" | None


class DetailOut(BaseModel):
    detail: str
