# Flagmint SDK Tester

<div align="center">

**A standalone tool for testing Flagmint's SDK protocol without writing code**

Built for QA engineers, demos, and debugging

</div>

---

## 📋 Overview

This app connects directly to your Flagmint API using the raw wire protocol (SSE, WebSocket, or HTTP long-polling). It does **not** use any Flagmint SDK — this is intentional, so you're testing the server contract, not the SDK's interpretation of it.

Perfect for:
- ✅ QA testing and validation
- 🐛 Debugging feature flag behavior
- 🎯 Testing targeting rules and context evaluation
- 🔄 Verifying real-time updates
- 📊 Comparing SSE vs WebSocket vs long-polling transport

## 🚀 Quick Start

### Prerequisites

- **Option A**: Node.js 16+ and npm
- **Option B**: Docker and Docker Compose
- A Flagmint API instance (local or remote)
- A valid SDK key from your Flagmint environment

### Installation

#### Option 1: Local Development (Node.js)

```bash
# Clone or download this repository
cd flagmint-sdk-tester

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser, paste your SDK key, leave transport on **SSE**, and connect.

#### Option 2: Docker (Recommended for Consistency)

**Using Docker Compose (Easiest):**

```bash
# Development mode (with hot reload)
docker-compose up dev

# Production mode (optimized build)
docker-compose up prod
```

**Using Docker directly:**

```bash
# Development mode
docker build --target development -t flagmint-sdk-tester:dev .
docker run -p 5173:5173 -v $(pwd):/app -v /app/node_modules flagmint-sdk-tester:dev

# Production mode
docker build --target production -t flagmint-sdk-tester:prod .
docker run -p 3000:3000 flagmint-sdk-tester:prod
```

**Access the application:**
- Development: [http://localhost:5173](http://localhost:5173)
- Production: [http://localhost:3000](http://localhost:3000)

### Build for Production (Local)

```bash
npm run build
npm run preview
```

## ✨ Features

### 🔌 Connection Management
- **Three transports** — SSE (JavaScript SDK path), WebSocket (Go SDK path), and HTTP long-polling
- **SSE protocol** — ASL handshake, flag stream, and context POST, matching the JS SDK
- **Connection Status** — Real-time visual indicators for connection state
- **Auto-reconnect** — SSE re-handshakes after a drop (session IDs are single-use)

### 🎯 Context Evaluation
- **Visual Context Builder** — Add/remove key-value pairs via UI
- **Context Presets** — Quick setups for common scenarios:
  - **Simple User** — Basic `{ kind: 'user', key: '...' }` context
  - **Multi-Context** — Complex `{ kind: 'multi', user: {...}, organization: {...} }` structure
  - **Empty** — No context (tests default evaluation paths)
- **Nested Context Support** — Use dot notation (e.g., `user.key`, `organization.plan`)
- **Type Inference** — Automatically converts `true`, `false`, and numeric strings

### 🚩 Flag Display
- **Live Flag Values** — See all flags with current values
- **Type Badges** — Visual indicators for boolean, string, number, JSON, and null types
- **Real-Time Updates** — Watch flags change instantly when modified in dashboard
- **Change History** — Expand any flag to see its value history over time
- **Flag Search** — Filter flags by name for large projects

### 📡 Protocol Logging
- **Message Inspector** — View handshake, SSE events (`connected`, `flags`, `quota_exceeded`, `error`), and HTTP context updates
- **Connection Events** — Track connect, disconnect, and error events
- **Debug Mode** — Toggle verbose logging for troubleshooting
- **Auto-scroll** — Automatically follows latest log entries

## 📖 Usage

### Basic Workflow

1. **Configure Connection**
   - Enter your API URL (e.g., `http://localhost:3000`)
   - Paste your SDK key
   - Choose transport: **SSE** (default, JS SDK), WebSocket (Go SDK), or Polling

2. **Set Up Context**
   - Use a preset or manually add context fields
   - Example user context:
     ```
     kind: user
     key: test-user-123
     country: US
     plan: pro
     ```

3. **Connect & Test**
   - Click "Connect" — connection status will turn green
   - Click "Send Context" to evaluate flags with your context
   - All matching flags will appear in the Flags tab

4. **Verify Real-Time Updates**
   - Open Flagmint dashboard in another tab
   - Toggle a flag value or targeting rule
   - Watch the tester update instantly (SSE `flags` event, or WebSocket)

### SSE protocol (JS SDK path)

The tester speaks the same wire protocol as `flagmint-js-sdk`:

1. `POST /auth/asl-handshake` with `x-api-key` → single-use `sessionId`
2. `GET /evaluator/v2/flags/stream?sessionId&context&sdkVersion&platform&wrapper*` (no API key)
3. Named events: `connected` (store `connectionId`), `flags`, `quota_exceeded`, `error`
4. `POST /evaluator/v2/flags/context` with `{ connectionId, context }` and `x-api-key` → HTTP 202; flags arrive on the open stream after a 400ms debounce

Watch the **Log** tab for handshake, `connectionId`, and event payloads.

### Testing Scenarios

#### Test User Targeting
```
Context:
  kind: user
  key: alice@example.com
  email: alice@example.com
  plan: enterprise
```
Verify flags target based on email domain or plan level.

#### Test Multi-Context Evaluation
```
Context:
  kind: multi
  user.kind: user
  user.key: alice@example.com
  organization.kind: organization
  organization.key: acme-corp
  organization.plan: enterprise
```
Verify organization-level flags override user-level defaults.

#### Test Empty Context
```
Context: (empty)
```
Verify default fallback values are returned correctly.

### QA Testing Checklist

- [ ] Flag evaluates with correct default value
- [ ] Flag respects user targeting rules
- [ ] Flag respects multi-context targeting
- [ ] Flag updates in real-time when changed in dashboard
- [ ] SSE handshake returns a `sessionId` (`POST /auth/asl-handshake`)
- [ ] SSE stream opens (`GET /evaluator/v2/flags/stream`) and emits `connected` then `flags`
- [ ] Send Context returns 202 and a new `flags` event after ~400ms
- [ ] SSE reconnects with a **new** handshake after a drop (session is single-use)
- [ ] Quota exhaustion emits `quota_exceeded` and closes the stream
- [ ] WebSocket connection is stable (no disconnects)
- [ ] Long-polling fallback works correctly
- [ ] Empty context returns expected defaults
- [ ] Custom context attributes are evaluated correctly
- [ ] Change history accurately tracks flag value changes

## 🏗️ Project Structure

```
flagmint-sdk-tester/
├── src/
│   ├── main.jsx         # React entry point
│   ├── App.jsx          # Main app component (UI, state management)
│   ├── connection.js    # Flagmint protocol client (WebSocket + long-polling)
│   └── helpers.js       # Utilities (type helpers, presets, context builder)
├── index.html           # HTML template
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
└── README.md            # This file
```

### Key Files

- **`connection.js`** — Raw protocol implementation. Handles SSE (handshake + stream + context POST), WebSocket, long-polling, message parsing, and keep-alive pings.
- **`helpers.js`** — Context building logic, type detection, and preset configurations.
- **`App.jsx`** — Complete UI with connection panel, context builder, flag viewer, and log inspector.

## 🔧 Configuration

### API URL

Default: `http://localhost:3000`

Update in the UI or set via localStorage:
```javascript
localStorage.setItem('fm_tester_url', 'https://your-api.com');
```

### SDK Key

Stored securely in localStorage (input type=password). Never committed to version control.

### CORS Configuration

If your Flagmint API runs on a different origin, ensure CORS allows:
```
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, x-api-key
```

SSE stream opens are GET with `sessionId` in the query string — do not send `x-api-key` on that request. Handshake and context updates use `x-api-key`.

## 🛠️ Tech Stack

- **React 19** — UI framework
- **Vite** — Build tool and dev server
- **EventSource API** — Server-Sent Events (JS SDK path)
- **WebSocket API** — Real-time communication (Go SDK path)
- **Fetch API** — ASL handshake, context POST, and long-polling fallback
- **Local Storage** — Persistent configuration

No external dependencies for networking or UI — pure browser APIs.

## 🐛 Troubleshooting

### Connection Fails
- ✅ Verify API URL is correct and reachable
- ✅ Check API key is valid for the environment
- ✅ Ensure API is running and healthy
- ✅ Check CORS configuration (see browser console for errors)

### No Flags Appear
- ✅ Verify SDK key has access to flags
- ✅ Check context matches targeting rules
- ✅ Try empty context to see default values
- ✅ Check Protocol Log tab for server responses

### SSE Stream Fails After Handshake
- ✅ Handshake is not billable; opening the stream is. Check quota if you see `quota_exceeded`
- ✅ `sessionId` is single-use — a second EventSource with the same id will fail
- ✅ Do not send `x-api-key` on `GET /evaluator/v2/flags/stream`
- ✅ Context on the stream URL is base64 JSON — avoid secrets/PII in context
- ✅ CORS must allow GET and `x-api-key` (handshake + context POST)

### WebSocket Disconnects
- ✅ Check API WebSocket endpoint is stable
- ✅ Try SSE or long-polling as fallback
- ✅ Verify no firewall/proxy blocking WebSocket connections
- ✅ Check API logs for errors

### Wrong Flag Values
- ✅ Verify context structure matches expected format
- ✅ Check targeting rules in Flagmint dashboard
- ✅ Review change history to see if value recently updated
- ✅ Enable Debug mode in Protocol Log to see evaluation details

## 🤝 Contributing

This is a testing tool for Flagmint SDK validation. Contributions welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/improvement`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/improvement`)
5. Open a Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Related

- [Flagmint Documentation](https://docs.flagmint.com)
- [Flagmint React SDK](https://github.com/flagmint/react-sdk)
- [Flagmint API](https://github.com/flagmint/api)

---

<div align="center">
Made with 💜 for the Flagmint community
</div>
