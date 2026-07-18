"""add career_goals table and roadmap career_goal_id

Revision ID: d4e8b6a17f52
Revises: c1a7f3e9b2d4
Create Date: 2026-07-18

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4e8b6a17f52"
down_revision: Union[str, None] = "c1a7f3e9b2d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "career_goals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("context", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "title", name="uq_career_goal_user_title"),
    )
    op.create_index(op.f("ix_career_goals_user_id"), "career_goals", ["user_id"], unique=False)
    op.add_column("roadmaps", sa.Column("career_goal_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_roadmaps_career_goal_id", "roadmaps", "career_goals", ["career_goal_id"], ["id"]
    )


def downgrade() -> None:
    op.drop_constraint("fk_roadmaps_career_goal_id", "roadmaps", type_="foreignkey")
    op.drop_column("roadmaps", "career_goal_id")
    op.drop_index(op.f("ix_career_goals_user_id"), table_name="career_goals")
    op.drop_table("career_goals")
