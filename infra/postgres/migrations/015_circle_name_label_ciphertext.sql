-- infra/postgres/migrations/015_circle_name_label_ciphertext.sql
-- C-3 Phase B: encrypted circle name + per-member label.
--   * circles.name_ciphertext / name_version (0=legacy plaintext in `name`,
--     1=AES-GCM(circle key) in name_ciphertext). Legacy rows default to 0.
--   * circle_members.member_label_ciphertext (AES-GCM(circle key) of {pubkey,name}).
-- Additive only. circles.name is kept until the lazy migration converges
-- (dropped in migration 016).

ALTER TABLE circles
    ADD COLUMN IF NOT EXISTS name_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS name_version    SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE circle_members
    ADD COLUMN IF NOT EXISTS member_label_ciphertext TEXT;
