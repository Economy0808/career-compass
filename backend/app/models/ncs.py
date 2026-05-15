"""NCS (국가직무능력표준) 관련 ORM 모델."""
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class NcsLclas(Base):
    """NCS 대분류 (Large Class).

    data.go.kr NCS001 오퍼레이션의 응답을 담는다.
    같은 코드라도 차수별로 행이 따로 존재하므로 (code, degree)가 복합 PK.
    """

    __tablename__ = "ncs_lclas"

    code: Mapped[str] = mapped_column(String(2), primary_key=True)
    degree: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=False)

    def __repr__(self) -> str:
        return f"NcsLclas(code={self.code!r}, degree={self.degree}, name={self.name!r}, is_current={self.is_current})"