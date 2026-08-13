ALTER TABLE users
  ADD COLUMN nip05_identifier TEXT,
  ADD COLUMN nip05_verified_at TIMESTAMPTZ,
  ADD COLUMN nip05_valid_until TIMESTAMPTZ,
  ADD CONSTRAINT users_nip05_identity_complete CHECK (
    (nip05_identifier IS NULL AND nip05_verified_at IS NULL AND nip05_valid_until IS NULL)
    OR
    (nip05_identifier IS NOT NULL
      AND length(nip05_identifier) BETWEEN 3 AND 255
      AND nip05_verified_at IS NOT NULL
      AND nip05_valid_until > nip05_verified_at)
  );

CREATE UNIQUE INDEX users_nip05_identifier_unique_idx
  ON users (nip05_identifier)
  WHERE nip05_identifier IS NOT NULL;
