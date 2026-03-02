# ✦ Clarify

> Highlight any word or phrase on any webpage and get an instant AI-powered explanation — in context.

Clarify is a Chrome extension that shows a floating tooltip when you select text, explaining what it means based on the surrounding content. It also includes a mini chat interface in the popup so you can ask follow-up questions directly.

---

## Features

- **Instant tooltips** — highlight any text and see a definition, contextual explanation, and usage example
- **Context-aware** — reads the surrounding paragraph so explanations are specific to the page you're on
- **Mini chat** — ask the AI anything directly from the popup
- **Provider choice** — works with both Anthropic (Claude) and OpenAI
- **Private by default** — your API key is stored locally and only ever sent to your chosen provider
- **Response cache** — repeated lookups are served instantly from local storage
- **Auto-lookup toggle** — turn off automatic triggering and use the chat instead

---

## Screenshots

| Tooltip on highlight | Mini chat popup | Settings |
|---|---|---|
| *(add screenshot)* | *(add screenshot)* | *(add screenshot)* |

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org) v18 or later
- [npm](https://npmjs.com) v9 or later
- Google Chrome (or any Chromium-based browser)

### 1. Clone the repository

```bash
git clone https://github.com/your-username/clarify.git
cd clarify
```

### 2. Install dependencies

```bash
cd extension
npm install
```

### 3. Build the extension

```bash
npm run build
```

This produces a ready-to-load `extension/dist/` folder.

### 4. Load in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/dist` folder

The Clarify icon (✦) will appear in your toolbar.

> **Note:** After loading the extension, reload any browser tabs that were already open — Chrome only injects content scripts into newly opened pages.

---

## Setup

1. Click the **✦ Clarify** icon in the toolbar
2. Choose your AI provider — **Claude** (Anthropic) or **OpenAI**
3. Paste your API key
   - Anthropic keys: [console.anthropic.com](https://console.anthropic.com)
   - OpenAI keys: [platform.openai.com](https://platform.openai.com)
4. Click **Save**

The popup will switch to the chat interface once your key is saved. Your key is stored in `chrome.storage.local` — it never leaves your device except in requests to the provider you chose.

---

## Usage

### Highlight-to-explain

1. Visit any webpage
2. Select any word or phrase with your mouse
3. A tooltip appears below your selection with:
   - **Definition** — a short, plain-English explanation
   - **In context** — how the term applies specifically to what you're reading
   - **Example** — a sample sentence using the term

Click **×** or press **Escape** to dismiss the tooltip. Clicking anywhere outside it also closes it.

### Mini chat

1. Click the **✦ Clarify** icon in the toolbar
2. Type a question in the input field and press **Enter** (or click →)
3. The full conversation history is sent with each message so the AI maintains context

### Settings

From the chat view, click the **⚙** gear icon to:
- Switch provider or model
- Update your API key
- Toggle auto-lookup on or off
- Clear the response cache

---

## Development

### Project structure

```
extension/
├── dist/                   # Built output — load this in Chrome
├── public/
│   ├── manifest.json       # MV3 manifest
│   └── icons/              # Generated PNG icons
├── src/
│   ├── types.ts            # Shared TypeScript types
│   ├── background/
│   │   └── background.ts   # Service worker: LLM calls + cache
│   ├── content/
│   │   └── contentScript.ts # Tooltip + selection handling
│   └── popup/
│       ├── App.tsx         # React settings + chat UI
│       ├── App.css         # Catppuccin Mocha dark theme
│       └── index.tsx       # Popup entry point
├── scripts/
│   ├── build-scripts.js    # esbuild runner (background + content script)
│   └── generate-icons.js   # Pure-Node PNG icon generator
├── index.html              # Vite popup entry
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### Available scripts

| Command | Description |
|---|---|
| `npm run build` | Full production build |
| `npm run dev:popup` | Watch mode for the popup (Vite) |
| `npm run dev:scripts` | Watch mode for background + content script (esbuild) |
| `npm run typecheck` | TypeScript check without emitting files |

### Making changes

- **Popup UI** — edit files in `src/popup/`, run `npm run dev:popup`, then reload the extension
- **Tooltip / selection logic** — edit `src/content/contentScript.ts`, run `npm run dev:scripts`, then reload the extension and refresh the target tab
- **LLM calls / cache** — edit `src/background/background.ts`, run `npm run dev:scripts`, then go to `chrome://extensions` and click the refresh icon for Clarify

After any build, go to `chrome://extensions` and click the **↺** refresh icon on the Clarify card to pick up the new `dist/` output.

---

## Supported models

| Provider | Suggested models |
|---|---|
| Claude (Anthropic) | `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-6` |
| OpenAI | `gpt-4o-mini`, `gpt-4o` |

You can type any valid model name into the Model field — the dropdown is just for convenience.

---

## Privacy

- Your API key is stored in `chrome.storage.local` (on your device only)
- Text selections and chat messages are sent directly from your browser to Anthropic or OpenAI — no intermediate server
- Lookup results are cached locally to avoid redundant API calls; use **Clear cache** in settings to wipe them

---

## License

MIT
