# SentinelMesh V2 Scope

This document defines the current product boundary.

## Supported Core

The V2 release supports four user-visible capabilities:

1. Browse loaded incidents on a map and alert list.
2. Submit a location-based community report signed by a local Nostr identity.
3. Confirm or deny community reports.
4. Manage and back up the local cryptographic identity, with an optional NIP-05 label verified against the local public key.

Push notifications will return after delivery is moved to a durable outbox and permission is explicitly requested by the user.

## Experimental Capabilities

The following implementations remain in the repository but are disabled by default and are not supported release capabilities:

- Acoustic detection
- Family Circles (NIP-44 key delivery and AES-GCM content encryption are implemented; location transport remains experimental)
- Insights
- Report photos
- Escape and home routing

They may only be exposed by setting their corresponding `VITE_ENABLE_EXPERIMENTAL_*` build flag to `true`. Enabling a flag does not make the capability production-ready.

## Trust Terms

- **Heuristic:** automated or incomplete evidence that has not been independently corroborated.
- **Corroborating:** multiple observations agree, but the incident has not met the confirmation policy.
- **Confirmed:** the stored trust policy has accepted the incident based on explicit evidence.
- **Retracted:** a previously surfaced incident has been withdrawn or corrected. Full retraction support is part of the V2 data-model work.

Severity and trust are independent. A `CRITICAL` event is not confirmed merely because its possible impact is high. Missing trust data must be presented as unverified.

## Release Rules

- The UI displays only stored facts; it does not infer confidence, sources, verification, or community scores from severity.
- Experimental features cannot trigger trusted public alerts in the default build.
- Documentation must distinguish implemented primitives from verified end-to-end behavior.
- A capability is supported only after its browser-to-server integration path and failure states are tested.
