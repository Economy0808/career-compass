"""init

Revision ID: 94453857611b
Revises: 
Create Date: 2026-05-08 19:48:03.864640

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '94453857611b'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
