# Flagmint SDK Tester

<div align="center">

**A standalone tool for testing Flagmint's SDK protocol without writing code**

Built for QA engineers, demos, and debugging

</div>

---

## 📋 Overview

This app connects directly to your Flagmint API using the raw wire protocol (WebSocket or HTTP long-polling). It does **not** use any Flagmint SDK — this is intentional, so you're testing the server contract, not the SDK's interpretation of it.

Perfect for:
- ✅ QA testing and validation
- 🐛 Debugging feature flag behavior
- 🎯 Testing targeting rules and context evaluation
- 🔄 Verifying real-time updates
- 📊 Comparing WebSocket vs long-polling transport

## 🚀 Quick Start

### Prerequisites

- Node.js 16+ and npm
- A Flagmint API instance (local or remote)
- A valid SDK key from your Flagmint environment

### Installation

```bash
# Clone or download this repository
cd flagmint-sdk-tester

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser, paste your SDK key, and connect!

### Build for Production

```bash
npm run build
npm run preview
```

## ✨ Features

### 🔌 Connection Management
- **Dual Transport Support** — Switch between WebSocket and HTTP long-polling
- **Connection Status** — Real-time visual indicators for connection state
- **Auto-reconnect** — Graceful handling of disconnections

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
- **Message Inspector** — View raw WebSocket messages
- **Connection Events** — Track connect, disconnect, and error events
- **Debug Mode** — Toggle verbose logging for troubleshooting
- **Auto-scroll** — Automatically follows latest log entries

## 📖 Usage

### Basic Workflow

1. **Configure Connection**
   - Enter your API URL (e.g., `http://localhost:3000`)
   - Paste your SDK key
   - Choose transport: WebSocket (recommended) or long-polling

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
   - Watch the tester update instantly (WebSocket)

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

- **`connection.js`** — Raw protocol implementation. Handles WebSocket connections, long-polling, message parsing, and keep-alive pings.
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
Access-Control-Allow-Headers: Content-Type, Authorization
```

## 🛠️ Tech Stack

- **React 19** — UI framework
- **Vite** — Build tool and dev server
- **WebSocket API** — Real-time communication
- **Fetch API** — Long-polling fallback
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

### WebSocket Disconnects
- ✅ Check API WebSocket endpoint is stable
- ✅ Try long-polling transport as fallback
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
