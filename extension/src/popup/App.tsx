import React, { useEffect, useRef, useState } from 'react';
import type { Config, Provider } from '../types';
import { DEFAULT_MODELS } from '../types';

type View = 'loading' | 'setup' | 'chat' | 'settings';
type Toast = { kind: 'saved' | 'error'; msg: string } | null;

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: '◆ Claude',
  openai: '⬡ OpenAI',
  gemini: '✦ Gemini',
};

const PROVIDER_HINTS: Record<Provider, string> = {
  claude: 'console.anthropic.com',
  openai: 'platform.openai.com',
  gemini: 'aistudio.google.com',
};

const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  claude: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  openai: ['gpt-4o-mini', 'gpt-4o'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

export default function App() {
  const [view, setView] = useState<View>('loading');
  const [config, setConfig] = useState<Config>({
    provider: 'claude',
    apiKey: '',
    model: DEFAULT_MODELS.claude,
    autoLookup: true,
    contextMaxLength: 600,
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [showKey, setShowKey] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chrome.storage.local
      .get(['provider', 'apiKey', 'model', 'autoLookup', 'contextMaxLength'])
      .then((s) => {
        const apiKey = (s.apiKey as string | undefined) || '';
        setConfig({
          provider: (s.provider as Provider) || 'claude',
          apiKey,
          model: s.model || DEFAULT_MODELS[(s.provider as Provider) || 'claude'],
          autoLookup: s.autoLookup !== false,
          contextMaxLength: typeof s.contextMaxLength === 'number' ? s.contextMaxLength : 600,
        });
        setView(apiKey.trim() ? 'chat' : 'setup');
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleProviderChange(provider: Provider) {
    setConfig((prev) => ({ ...prev, provider, model: DEFAULT_MODELS[provider] }));
  }

  async function save() {
    if (!config.apiKey.trim()) {
      flash({ kind: 'error', msg: 'API key is required.' });
      return;
    }
    await chrome.storage.local.set({
      provider: config.provider,
      apiKey: config.apiKey.trim(),
      model: config.model.trim() || DEFAULT_MODELS[config.provider],
      autoLookup: config.autoLookup,
      contextMaxLength: config.contextMaxLength,
    });
    flash({ kind: 'saved', msg: 'Settings saved' });
    setTimeout(() => setView('chat'), 500);
  }

  async function openSettings() {
    // Re-read from storage so the form always shows the saved values
    const s = await chrome.storage.local.get(['provider', 'apiKey', 'model', 'autoLookup', 'contextMaxLength']);
    setConfig({
      provider: (s.provider as Provider) || 'claude',
      apiKey: (s.apiKey as string) || '',
      model: s.model || DEFAULT_MODELS[(s.provider as Provider) || 'claude'],
      autoLookup: s.autoLookup !== false,
      contextMaxLength: typeof s.contextMaxLength === 'number' ? s.contextMaxLength : 600,
    });
    setView('settings');
  }

  async function sendChat() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    const userMsg: Msg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setSending(true);
    chrome.runtime.sendMessage(
      { type: 'chat', payload: { messages: newMessages } },
      (resp: { reply?: string; error?: string } | undefined) => {
        // Suppress the chrome.runtime.lastError warning when SW is waking up
        void chrome.runtime.lastError;
        setSending(false);
        const aiMsg: Msg = {
          role: 'assistant',
          content: resp?.reply ?? `Error: ${resp?.error ?? 'No response from extension.'}`,
        };
        setMessages((prev) => [...prev, aiMsg]);
      },
    );
  }

  async function clearCache() {
    await chrome.runtime.sendMessage({ type: 'clear_cache' });
    flash({ kind: 'saved', msg: 'Cache cleared' });
  }

  function flash(t: NonNullable<Toast>) {
    setToast(t);
    setTimeout(() => setToast(null), 2200);
  }

  // ── Loading ────────────────────────────────────────────────────

  if (view === 'loading') {
    return (
      <div className="app" style={{ minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#585b70', fontSize: 12 }}>Loading…</span>
      </div>
    );
  }

  // ── Settings form (setup + settings views share this layout) ───

  if (view === 'setup' || view === 'settings') {
    return (
      <div className="app">
        <header className="header settings-header">
          <div>
            <div className="logo">✦ Clarify</div>
            <p className="tagline">Highlight any text for an AI explanation</p>
          </div>
          {view === 'settings' && (
            <button className="icon-btn back-btn" onClick={() => setView('chat')} title="Back to chat">
              ←
            </button>
          )}
        </header>

        {/* Provider */}
        <div className="field">
          <label className="label">Provider</label>
          <div className="segmented">
            {(['claude', 'openai', 'gemini'] as Provider[]).map((p) => (
              <button
                key={p}
                className={`seg-btn${config.provider === p ? ' active' : ''}`}
                onClick={() => handleProviderChange(p)}
              >
                {PROVIDER_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* API Key */}
        <div className="field">
          <label className="label">API Key</label>
          <div className="input-row">
            <input
              className="input"
              type={showKey ? 'text' : 'password'}
              placeholder={`Your ${config.provider === 'claude' ? 'Anthropic' : config.provider === 'openai' ? 'OpenAI' : 'Google AI'} key`}
              value={config.apiKey}
              onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button
              className="icon-btn"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? 'Hide key' : 'Show key'}
            >
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
          <p className="hint">
            Get yours at{' '}
            <a
              href={`https://${PROVIDER_HINTS[config.provider]}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {PROVIDER_HINTS[config.provider]}
            </a>
            . Stored locally only.
          </p>
        </div>

        {/* Model */}
        <div className="field">
          <label className="label">Model</label>
          <input
            className="input"
            list="model-list"
            value={config.model}
            onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
            placeholder="Model name"
          />
          <datalist id="model-list">
            {MODEL_SUGGESTIONS[config.provider].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        {/* Auto-lookup toggle */}
        <div className="field row">
          <div>
            <span className="label" style={{ display: 'inline', marginBottom: 0 }}>
              Auto-lookup on highlight
            </span>
            <p className="hint" style={{ marginTop: 2 }}>
              Trigger on mouse release — no hotkey needed
            </p>
          </div>
          <button
            className={`toggle${config.autoLookup ? ' on' : ' off'}`}
            onClick={() => setConfig((prev) => ({ ...prev, autoLookup: !prev.autoLookup }))}
          >
            {config.autoLookup ? 'On' : 'Off'}
          </button>
        </div>

        {/* Actions */}
        <div className="actions">
          <button className="btn primary" onClick={save}>
            Save
          </button>
          {view === 'settings' && (
            <button className="btn ghost" onClick={clearCache}>
              Clear cache
            </button>
          )}
        </div>

        {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}

        {view === 'setup' && (
          <footer className="footer">
            Clarify v0.1 ·{' '}
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">
              Source
            </a>
          </footer>
        )}
      </div>
    );
  }

  // ── Chat view ──────────────────────────────────────────────────

  return (
    <div className="app chat-app">
      <header className="header chat-header">
        <div className="logo">✦ Clarify</div>
        <button className="gear-btn" onClick={openSettings} title="Settings">
          ⚙
        </button>
      </header>

      <div className="chat-body">
        {/* Static welcome message */}
        <div className="msg assistant">
          Hello! Ask me anything, or highlight text on any page for an instant explanation.
        </div>

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}

        {sending && (
          <div className="msg assistant">
            <span className="typing-dots">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          className="input"
          placeholder="Ask anything…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) sendChat();
          }}
          disabled={sending}
        />
        <button
          className="btn primary send-btn"
          onClick={sendChat}
          disabled={sending || !input.trim()}
        >
          →
        </button>
      </div>

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
