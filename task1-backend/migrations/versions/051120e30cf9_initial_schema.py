"""initial schema

Revision ID: 051120e30cf9
Revises: 
Create Date: 2026-11-16 17:41:06.589423

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '051120e30cf9'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('call_events',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('event_id', sa.String(length=64), nullable=False),
    sa.Column('event_type', sa.String(length=32), nullable=False),
    sa.Column('account_id', sa.String(length=64), nullable=False),
    sa.Column('call_id', sa.String(length=64), nullable=False),
    sa.Column('occurred_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('duration_seconds', sa.Integer(), nullable=False),
    sa.Column('cost_cents', sa.Integer(), nullable=False),
    sa.Column('destination_country', sa.String(length=8), nullable=True),
    sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('dead', sa.Boolean(), nullable=False),
    sa.Column('last_error', sa.String(length=512), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('event_id')
    )
    op.create_index(op.f('ix_call_events_account_id'), 'call_events', ['account_id'], unique=False)
    op.create_index(op.f('ix_call_events_occurred_at'), 'call_events', ['occurred_at'], unique=False)
    op.create_index('ix_call_events_pending', 'call_events', ['next_attempt_at'], unique=False, postgresql_where=sa.text('processed_at IS NULL AND dead = false'))
    op.create_index('uq_call_ended_call_id', 'call_events', ['call_id'], unique=True, postgresql_where=sa.text("event_type = 'call.ended'"))
    op.create_table('usage_monthly',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('account_id', sa.String(length=64), nullable=False),
    sa.Column('period_month', sa.Date(), nullable=False),
    sa.Column('duration_seconds', sa.Integer(), nullable=False),
    sa.Column('cost_cents', sa.Integer(), nullable=False),
    sa.Column('calls_started', sa.Integer(), nullable=False),
    sa.Column('calls_ended', sa.Integer(), nullable=False),
    sa.Column('calls_failed', sa.Integer(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('account_id', 'period_month', name='uq_usage_account_month')
    )
    op.create_index(op.f('ix_usage_monthly_account_id'), 'usage_monthly', ['account_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_usage_monthly_account_id'), table_name='usage_monthly')
    op.drop_table('usage_monthly')
    op.drop_index('uq_call_ended_call_id', table_name='call_events', postgresql_where=sa.text("event_type = 'call.ended'"))
    op.drop_index('ix_call_events_pending', table_name='call_events', postgresql_where=sa.text('processed_at IS NULL AND dead = false'))
    op.drop_index(op.f('ix_call_events_occurred_at'), table_name='call_events')
    op.drop_index(op.f('ix_call_events_account_id'), table_name='call_events')
    op.drop_table('call_events')
    # ### end Alembic commands ###
