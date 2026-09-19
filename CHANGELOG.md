# Changelog

All notable changes to the Flagmint SDK Tester are documented in this file.

## [1.2.0] — 2026-09-17

### Added

- **Light + dark themes** with a header toggle (persisted). Default is light.
- **Environment picker** (Local / Staging / Production / Custom) that fills API + Stream URLs.
- Separate **Stream URL** for SSE (`staging-stream.flagmint.com` / `stream.flagmint.com`) while handshake, context, QA, and REST stay on the API host.
- **How to use** panel and QA button tooltips (portal tooltip, Flagmint-style).

### Changed

- Connection layer opens EventSource on `streamUrl` and keeps ASL / context / evaluate / WebSocket on `apiUrl`.
- QA buttons use a light surface so they stay readable in both themes.

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
