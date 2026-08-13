ALTER TABLE circle_members
  ADD COLUMN key_wrap_version SMALLINT,
  ADD COLUMN key_wrap_ciphertext TEXT,
  ADD CONSTRAINT circle_members_key_wrap_complete CHECK (
    (key_wrap_version IS NULL AND key_wrap_ciphertext IS NULL)
    OR
    (key_wrap_version = 2
      AND key_wrap_ciphertext IS NOT NULL
      AND length(key_wrap_ciphertext) BETWEEN 132 AND 4096)
  );
