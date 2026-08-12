-- Remove obsolete publication pipeline state while preserving user-signed
-- Nostr identity, report, vote, and vouch records.

DROP TABLE publish_failures;
DROP TABLE utxos;
DROP TABLE publish_jobs;

ALTER TABLE safety_events
  DROP COLUMN bitcoin_txid,
  DROP COLUMN bitcoin_block;

ALTER TABLE community_reports
  DROP COLUMN bitcoin_block;
