-- Legacy location rows use an incompatible recipient envelope and may contain
-- sender key material. They cannot be safely upgraded in place.
TRUNCATE TABLE location_blobs;

ALTER TABLE circles
  ADD COLUMN key_epoch INTEGER NOT NULL DEFAULT 1 CHECK (key_epoch > 0),
  ADD COLUMN location_protocol_version SMALLINT NOT NULL DEFAULT 0
    CHECK (location_protocol_version IN (0, 1)),
  ADD COLUMN rekey_required BOOLEAN NOT NULL DEFAULT true;

DROP INDEX IF EXISTS location_blobs_recipient_idx;

ALTER TABLE location_blobs
  DROP COLUMN recipient_token,
  DROP COLUMN sender_ephemeral_pubkey;

ALTER TABLE location_blobs
  RENAME COLUMN encrypted_payload TO ciphertext;

ALTER TABLE location_blobs
  ADD COLUMN protocol_version SMALLINT NOT NULL,
  ADD COLUMN key_epoch INTEGER NOT NULL,
  ADD COLUMN sender_token TEXT NOT NULL,
  ADD COLUMN ciphertext_hash BYTEA NOT NULL,
  ALTER COLUMN expires_at DROP DEFAULT,
  ADD CONSTRAINT location_blobs_protocol_v1 CHECK (protocol_version = 1),
  ADD CONSTRAINT location_blobs_epoch_positive CHECK (key_epoch > 0),
  ADD CONSTRAINT location_blobs_sender_token_size CHECK (octet_length(sender_token) BETWEEN 4 AND 256),
  ADD CONSTRAINT location_blobs_ciphertext_size CHECK (octet_length(ciphertext) BETWEEN 1 AND 22000),
  ADD CONSTRAINT location_blobs_hash_size CHECK (octet_length(ciphertext_hash) = 32),
  ADD CONSTRAINT location_blobs_expiry_window CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '5 minutes'
  ),
  ADD CONSTRAINT location_blobs_one_per_sender UNIQUE (circle_id, sender_token),
  ADD CONSTRAINT location_blobs_replay_hash UNIQUE (ciphertext_hash);

CREATE INDEX location_blobs_expiry_idx_v1 ON location_blobs (expires_at);
