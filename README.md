# Flagmint SDK Tester

A standalone tool for testing Flagmint's SDK protocol without writing code.
Built for QA engineers, demos, and debugging.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173, paste your SDK key, and connect.

## What It Does

This app connects directly to your Flagmint API using the raw wire protocol
(WebSocket or HTTP long-polling). It does **not** use any Flagmint SDK — this
is intentional, so you're testing the server contract, not the SDK's
interpretation of it.

### Features

- **Connect via WebSocket or long-polling** — toggle between transports
- **Build evaluation context via UI** — key/value fields with presets for
  single-user, multi-context, and empty context
- **Live flag display** — see all flags with type badges, current values
- **Real-time updates** — toggle a flag in the dashboard, see it change here
- **Change history** — expand any flag to see its value over time
- **Protocol log** — see raw WebSocket messages, connection events, errors

### Context Presets

- **User** — simple `{ kind: 'user', key: '...' }` context
- **Multi** — multi-context `{ kind: 'multi', user: {...}, organization: {...} }`
  matching the shape the React/Vue SDKs send
- **Empty** — no context at all (tests the "no user.key" evaluation path)

## Usage for QA

1. Create a flag in the Flagmint dashboard
2. Open this tester and connect with your environment's SDK key
3. Set up a user context and click "Send Context"
4. Verify the flag evaluates correctly
5. Toggle the flag in the dashboard — watch it update in real-time
6. Switch transport to long-polling — verify same results
7. Try different context attributes — verify targeting rules work

## No Backend Required

This connects to your existing Flagmint API. No new endpoints needed.

Just make sure CORS allows the tester's origin (localhost:5173) if your API
is running on a different port or domain.

## Project Structure

```
src/
  main.jsx        — React entry point
  App.jsx         — Main app component (config panel, flags, log)
  connection.js   — Flagmint protocol client (WS + polling)
  helpers.js      — Type helpers, presets, context builder
```
