"""인증 관련 ORM 모델: 세션, 이메일 인증 코드, 학생증 심사."""

from datetime import datetime
from typing import Literal

from sqlalchemy import ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.roadmap import User

VerificationPurpose = Literal["signup_email", "school_email", "password_reset"]
CardStatus = Literal["pending", "approved", "rejected"]


class AuthSession(Base):
    """서버측 세션. 쿠키에는 opaque 토큰만 나가고 DB에는 SHA-256 해시만 저장한다."""

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)

    user: Mapped[User] = relationship()

    def __repr__(self) -> str:
        return f"AuthSession(id={self.id}, user_id={self.user_id})"


class EmailVerification(Base):
    """이메일 인증 코드. 코드는 해시로만 저장하고 10분 만료·시도 횟수 제한."""

    __tablename__ = "email_verifications"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    email: Mapped[str] = mapped_column(nullable=False)
    purpose: Mapped[str] = mapped_column(nullable=False)  # VerificationPurpose
    code_hash: Mapped[str] = mapped_column(nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    attempts: Mapped[int] = mapped_column(nullable=False, server_default="0")
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    user: Mapped[User] = relationship()

    def __repr__(self) -> str:
        return f"EmailVerification(id={self.id}, purpose={self.purpose!r})"


class StudentCardVerification(Base):
    """학생증 심사 건. PIPA: 심사 결정 즉시 이미지 파일을 삭제하고 image_path를 비운다."""

    __tablename__ = "student_card_verifications"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    image_path: Mapped[str | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(nullable=False, server_default="pending")  # CardStatus
    reject_reason: Mapped[str | None] = mapped_column(nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    user: Mapped[User] = relationship()

    def __repr__(self) -> str:
        return f"StudentCardVerification(id={self.id}, status={self.status!r})"
