# 🚑 EMS Inventory Scanner

Camera-based medication & equipment inventory tracker for EMS units.
Scan labels with your phone or computer camera — AI reads the name, expiration date, lot number, and barcode automatically.

---

## Requirements

- [Node.js](https://nodejs.org/) version 18 or newer
- An [Anthropic API key](https://console.anthropic.com/) (for AI label reading)
- VS Code (recommended) or any terminal

---

## Setup (one time)

### Step 1 — Open the project in VS Code
Open the `ems-inventory` folder in VS Code.

### Step 2 — Install dependencies
Open the VS Code terminal (`` Ctrl+` `` or Terminal → New Terminal) and run:

```bash
npm install
```

### Step 3 — Add your API key
Open the `.env` file and replace `your_api_key_here` with your actual Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...your key here...
```

Get a key at: https://console.anthropic.com/

---

## Running the app

```bash
npm run dev
```

This starts both servers:
- **Backend** (Express API + inventory storage) → http://localhost:3001
- **Frontend** (React/Vite dev server) → http://localhost:5173

Open **http://localhost:5173** in your browser.

> On your phone: connect to the same Wi-Fi network, then open `http://YOUR_COMPUTER_IP:5173`
> Find your IP with `ipconfig` (Windows) or `ifconfig` (Mac/Linux)

---

## For production / deployment

Build the frontend:
```bash
npm run build
```

Then run just the server (it serves the built frontend):
```bash
npm start
```

Open http://localhost:3001

---

## Project structure

```
ems-inventory/
├── src/
│   ├── App.jsx        ← Main React application
│   ├── main.jsx       ← React entry point
│   └── index.css      ← Global styles
├── data/
│   └── inventory.json ← Shared inventory (auto-created)
├── server.js          ← Express backend (API + file storage)
├── vite.config.js     ← Vite config (proxies /api to server)
├── index.html         ← HTML entry point
├── .env               ← Your API key (never commit this)
└── package.json
```

---

## Features

- 📷 **Camera scanning** — point at any label and capture
- 🤖 **AI label reading** — extracts name, expiration, lot, NDC, quantity
- ⚠️ **Expiration badges** — EXPIRED / EXP SOON / WATCH / GOOD
- 🔍 **Search** — filter by name, lot, location, barcode
- 📤 **Export CSV** — download inventory for reporting
- 💾 **Shared storage** — inventory saved to `data/inventory.json`, visible to all users on the same server
- ✍️ **Manual entry** — for items where scanning doesn't work
