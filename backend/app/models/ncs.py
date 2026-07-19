"""NCS (국가직무능력표준) 관련 ORM 모델."""

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKeyConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# text-embedding-3-small 차원. Settings.embedding_dimensions와 함께 움직인다.
EMBEDDING_DIM = 1536


class NcsLclas(Base):
    """NCS Large Class."""

    __tablename__ = "ncs_lclas"

    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    degree: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=False)

    def __repr__(self) -> str:
        return f"NcsLclas(code={self.code!r}, degree={self.degree}, name={self.name!r})"


class NcsMclas(Base):
    """NCS Middle Class. FK -> ncs_lclas(code, degree)."""

    __tablename__ = "ncs_mclas"
    __table_args__ = (
        ForeignKeyConstraint(
            ["lclas_code", "degree"],
            ["ncs_lclas.code", "ncs_lclas.degree"],
        ),
    )

    code: Mapped[str] = mapped_column(String(4), primary_key=True)
    degree: Mapped[int] = mapped_column(Integer, primary_key=True)
    lclas_code: Mapped[str] = mapped_column(String(2), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=False)

    def __repr__(self) -> str:
        return f"NcsMclas(code={self.code!r}, degree={self.degree}, name={self.name!r})"


class NcsSclas(Base):
    """NCS Small Class. FK -> ncs_mclas(code, degree)."""

    __tablename__ = "ncs_sclas"
    __table_args__ = (
        ForeignKeyConstraint(
            ["mclas_code", "degree"],
            ["ncs_mclas.code", "ncs_mclas.degree"],
        ),
    )

    code: Mapped[str] = mapped_column(String(6), primary_key=True)
    degree: Mapped[int] = mapped_column(Integer, primary_key=True)
    mclas_code: Mapped[str] = mapped_column(String(4), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=False)

    def __repr__(self) -> str:
        return f"NcsSclas(code={self.code!r}, degree={self.degree}, name={self.name!r})"


class NcsJob(Base):
    """NCS Job. FK -> ncs_sclas(code, degree)."""

    __tablename__ = "ncs_job"
    __table_args__ = (
        ForeignKeyConstraint(
            ["sclas_code", "degree"],
            ["ncs_sclas.code", "ncs_sclas.degree"],
        ),
    )

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    degree: Mapped[int] = mapped_column(Integer, primary_key=True)
    lclas_code: Mapped[str] = mapped_column(String(2), nullable=False)
    mclas_code: Mapped[str] = mapped_column(String(4), nullable=False)
    sclas_code: Mapped[str] = mapped_column(String(6), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=False)
    # 계층명을 붙인 직무 텍스트의 임베딩. 백필 전에는 NULL이고, 그동안 매칭은
    # pg_trgm 경로로 동작한다 (app/services/ncs_repo.py).
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)

    def __repr__(self) -> str:
        return f"NcsJob(code={self.code!r}, degree={self.degree}, name={self.name!r})"


class NcsAbilityUnit(Base):
    """NCS Ability Unit. FK -> ncs_job(code, degree)."""

    __tablename__ = "ncs_ability_unit"
    __table_args__ = (
        ForeignKeyConstraint(
            ["job_code", "degree"],
            ["ncs_job.code", "ncs_job.degree"],
        ),
    )

    code: Mapped[str] = mapped_column(String(14), primary_key=True)
    degree: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=False)

    def __repr__(self) -> str:
        return f"NcsAbilityUnit(code={self.code!r}, degree={self.degree}, name={self.name!r})"
