"""add career_goals.is_featured

Revision ID: e7b2c5d90a13
Revises: d4e8b6a17f52
Create Date: 2026-07-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "e7b2c5d90a13"
down_revision: Union[str, None] = "d4e8b6a17f52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "career_goals",
        sa.Column("is_featured", sa.Boolean(), server_default="true", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("career_goals", "is_featured")
