"""add milestone detail column

Revision ID: c1a7f3e9b2d4
Revises: 418b219c27e8
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1a7f3e9b2d4'
down_revision: Union[str, None] = '418b219c27e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # detail: 마일스톤 상세 가이드 (클릭 시 표시). 기존 행 호환을 위해 nullable.
    op.add_column('milestones', sa.Column('detail', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('milestones', 'detail')
