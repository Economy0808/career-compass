"""expand_ncs_ability_unit_pk

Revision ID: 1491b23771c8
Revises: a2f41c40a539
Create Date: 2026-07-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1491b23771c8'
down_revision: Union[str, None] = 'a2f41c40a539'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('ncs_ability_unit')
    op.create_table(
        'ncs_ability_unit',
        sa.Column('code', sa.String(length=14), nullable=False),
        sa.Column('degree', sa.Integer(), nullable=False),
        sa.Column('job_code', sa.String(length=8), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('is_current', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['job_code', 'degree'], ['ncs_job.code', 'ncs_job.degree']),
        sa.PrimaryKeyConstraint('code', 'degree', 'job_code'),
    )


def downgrade() -> None:
    op.drop_table('ncs_ability_unit')
    op.create_table(
        'ncs_ability_unit',
        sa.Column('code', sa.String(length=14), nullable=False),
        sa.Column('degree', sa.Integer(), nullable=False),
        sa.Column('job_code', sa.String(length=8), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('is_current', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['job_code', 'degree'], ['ncs_job.code', 'ncs_job.degree']),
        sa.PrimaryKeyConstraint('code', 'degree'),
    )
