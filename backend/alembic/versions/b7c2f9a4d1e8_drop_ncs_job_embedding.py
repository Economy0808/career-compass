"""drop ncs_job.embedding column (embedding matching removed)

NCS job matching now uses pg_trgm + ILIKE + LLM judge only; the pgvector
embedding column and its OpenAI backfill are dead code. The vector extension
stays enabled (harmless) so downgrade can re-add the column.

Revision ID: b7c2f9a4d1e8
Revises: f3a91d05c8e7
Create Date: 2026-07-23

"""

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op

# revision identifiers, used by Alembic.
revision = "b7c2f9a4d1e8"
down_revision = "f3a91d05c8e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("ncs_job", "embedding")


def downgrade() -> None:
    op.add_column("ncs_job", sa.Column("embedding", Vector(1536), nullable=True))
