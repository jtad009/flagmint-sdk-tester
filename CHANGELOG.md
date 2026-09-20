# Changelog

All notable changes to the Flagmint SDK Tester are documented in this file.

## [1.3.0] — 2026-09-20

### Added

- **Tools** tab for config-sync QA without digging the log:
  - **Live patch inspection** — upserts, deletes, and segment ids after each verified `fullConfig` / `delta` / `deltas`
  - **Track events** — send `custom` or `error` to `/evaluator/events` (Evaluate still auto-reports `evaluation`)
  - **Same-version check** — plain-English REST helper (`GET /flags/config?sinceVersion=N`) to prove lease-only; raw JSON under “Show raw response”
  - **Tamper demo** — flip the last payload signature and prove reject
  - **Coverage** note — wire protocol + vendored config-sync by design; not the published `FlagClient` (`ready()`, tab sharing, SSE→poll fallback, npm packaging)
- **QA client clock** — Clock / +25h / Reset mirror the server offset onto the tester lease timer so +25h expires leases without waiting a day; lease gate re-runs after advance
- Collapsible sidebar sections (Connection, Config sync, QA, Evaluation context), collapsed by default; Connect / Disconnect stays pinned
- Plain-English config-sync status (**Flags ready** / **Rules expired**) with **Show technical details** for cache version and lease ISO
- How-to guide bodies support light markdown (paragraphs, lists, `` `code` ``, `**bold**`)

### Changed

- Config-sync “Flags ready” requires a cache with **version and flags** (aligned with `forceFullConfig` / reconnect)
- Expired lease while disconnected says **Rules expired** (not “renewing”)
- How-to QA clock copy: **Clock** only syncs the tester; **+25h** / **Reset** move the server clock then sync

### Notes

- Still requires FF-EU with config-sync + QA routes for clock / clear / replay. Use **SSE** for config-sync mode.

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
