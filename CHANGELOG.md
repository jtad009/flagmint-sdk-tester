# Changelog

All notable changes to the Flagmint SDK Tester are documented in this file.

## [1.1.0] — 2026-09-15

### Added

- **Config sync mode** (`fullConfig / deltas`) on SSE: ECDH + signature verify + local rules store (aligned with flagmint-js-sdk 2.1).
- **Evaluate** on a single flag using sidebar context (proves local call-site eval).
- **QA controls:** clock, +25h, reset clock, server state, clear server rules, replay compile, clear local cache.
- Sync script `npm run sync:config-sync` to copy config-sync sources from the JS SDK repo.

### Changed

- Default **Legacy flags** mode remains available for the old server-evaluated stream path.

### Notes

- Requires FF-EU **1.5.0+** with config-sync enabled. Use **SSE** transport for config-sync mode.
- Private tooling package — not published to npm.

## [1.0.0] — 2026-03-30

### Added

- Initial standalone tester (SSE / WebSocket / long-polling) for Flagmint without writing app code.
