"""add ncs_job.embedding + enable vector/pg_trgm extensions

Revision ID: f3a91d05c8e7
Revises: e7b2c5d90a13
Create Date: 2026-07-20

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

revision: str = "f3a91d05c8e7"
down_revision: Union[str, None] = "e7b2c5d90a13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.add_column("ncs_job", sa.Column("embedding", Vector(1536), nullable=True))


def downgrade() -> None:
    op.drop_column("ncs_job", "embedding")
    # Extensions are left in place: other objects may depend on them and both
    # are harmless when unused.
