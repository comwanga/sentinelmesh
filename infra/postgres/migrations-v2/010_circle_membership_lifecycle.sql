-- Circle membership lifecycle and v2 key-wrap epochs.
--
-- Circles gain a membership revision counter used for optimistic atomic epoch
-- commits: the owner must present the revision it built a wrap set against, and
-- any concurrent membership change (invite/accept/remove/leave) bumps the
-- counter, making a stale commit fail closed.
--
-- Circle members gain lifecycle state (PENDING|ACTIVE), an acceptance timestamp,
-- and v2 epoch-bound key-wrap columns. The legacy key_wrap_version /
-- key_wrap_ciphertext columns (migration 006) are preserved for protocol-0
-- read-only recovery: v1 wraps never carry a live location key.

ALTER TABLE circles
  ADD COLUMN membership_revision INTEGER NOT NULL DEFAULT 0
    CHECK (membership_revision >= 0);

ALTER TABLE circle_members
  ADD COLUMN membership_state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (membership_state IN ('PENDING', 'ACTIVE')),
  ADD COLUMN accepted_at TIMESTAMPTZ,
  ADD COLUMN key_wrap_epoch INTEGER,
  ADD COLUMN key_wrap_event JSONB,
  ADD CONSTRAINT circle_members_key_wrap_v2_complete CHECK (
    (key_wrap_epoch IS NULL AND key_wrap_event IS NULL)
    OR (key_wrap_epoch IS NOT NULL AND key_wrap_event IS NOT NULL)
  ),
  ADD CONSTRAINT circle_members_key_wrap_epoch_positive CHECK (
    key_wrap_epoch IS NULL OR key_wrap_epoch > 0
  ),
  ADD CONSTRAINT circle_members_pending_requires_v2_wrap CHECK (
    membership_state <> 'PENDING' OR key_wrap_epoch IS NOT NULL
  );

CREATE INDEX circle_members_state_idx ON circle_members (circle_id, membership_state);
