// Content script: captures text selections, sends lookup requests to the
// background service worker, and renders results in a Shadow DOM tooltip
// so extension styles never conflict with the host page.

const DEBOUNCE_MS = 350;
const MAX_SELECTION_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 600;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastLookupText = '';
let autoLookup = true;

// Shadow DOM refs
let tooltipHost: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let tooltipEl: HTMLElement | null = null;

// ── Load auto-lookup setting ──────────────────────────────────────

chrome.storage.local.get('autoLookup').then(({ autoLookup: al }) => {
  autoLookup = al !== false;
});

chrome.storage.onChanged.addListener((changes) => {
  if ('autoLookup' in changes) {
    autoLookup = changes.autoLookup.newValue !== false;
  }
});

// ── Shadow DOM setup ──────────────────────────────────────────────

function ensureTooltip(): HTMLElement {
  if (tooltipEl) return tooltipEl;

  tooltipHost = document.createElement('div');
  tooltipHost.setAttribute('data-clarify-host', '');
  // position:fixed keeps it out of any stacking context (e.g. Google Translate).
  // pointer-events:none on the host lets clicks pass through to the page;
  // the inner .tooltip re-enables them for the close button.
  tooltipHost.style.cssText =
    'all:initial;position:fixed;z-index:2147483647;pointer-events:none;';

  shadowRoot = tooltipHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }

    .tooltip {
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.55;
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 12px;
      padding: 14px 16px;
      max-width: 360px;
      min-width: 200px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.07);
      box-sizing: border-box;
      animation: clarify-in 0.12s ease-out;
    }

    @keyframes clarify-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .word {
      font-weight: 700;
      font-size: 14px;
      color: #cba6f7;
      margin-bottom: 6px;
      padding-right: 20px;
    }

    .def   { color: #cdd6f4; margin-bottom: 5px; }

    .explain {
      color: #a6adc8;
      font-size: 12px;
      margin-bottom: 5px;
    }

    .example {
      color: #89b4fa;
      font-size: 12px;
      font-style: italic;
      border-left: 2px solid #45475a;
      padding-left: 8px;
      margin-top: 4px;
    }

    .error { color: #f38ba8; }

    .loading {
      color: #a6adc8;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .spinner {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      border: 2px solid #45475a;
      border-top-color: #cba6f7;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .close-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      background: none;
      border: none;
      cursor: pointer;
      color: #585b70;
      font-size: 16px;
      line-height: 1;
      padding: 0;
      transition: color 0.1s;
    }
    .close-btn:hover { color: #cdd6f4; }

    .wrap { position: relative; }
  `;
  shadowRoot.appendChild(style);

  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.style.display = 'none';
  shadowRoot.appendChild(tooltipEl);

  // Append to <html> so body overflow:hidden or transforms can't clip us
  document.documentElement.appendChild(tooltipHost);
  return tooltipEl;
}

// ── Positioning ───────────────────────────────────────────────────
// rect is in *viewport* coordinates (raw from getBoundingClientRect).
// position:fixed uses the same coordinate space, so no scroll offset needed.

function positionHost(rect: { top: number; left: number; bottom: number }) {
  if (!tooltipHost) return;
  const OFFSET = 10;
  const x = Math.max(8, rect.left);
  const y = rect.bottom + OFFSET;
  tooltipHost.style.top = `${y}px`;
  tooltipHost.style.left = `${x}px`;

  // After render, clamp to viewport so the tooltip never goes off-screen
  requestAnimationFrame(() => {
    if (!tooltipHost) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tw = tooltipHost.offsetWidth;
    const th = tooltipHost.offsetHeight;
    // Shift left if overflowing the right edge
    if (x + tw > vw - 8) {
      tooltipHost.style.left = `${Math.max(8, vw - tw - 8)}px`;
    }
    // Flip above the selection if overflowing the bottom edge
    if (y + th > vh - 8) {
      tooltipHost.style.top = `${Math.max(8, rect.top - th - OFFSET)}px`;
    }
  });
}

// ── Render states ─────────────────────────────────────────────────

function showLoading(
  text: string,
  rect: { top: number; left: number; bottom: number },
) {
  const t = ensureTooltip();
  positionHost(rect);
  t.style.display = 'block';
  t.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <span>Looking up <b>${esc(text)}</b>…</span>
    </div>
  `;
}

function showResult(
  text: string,
  resp: Record<string, string>,
  rect: { top: number; left: number; bottom: number },
) {
  const t = ensureTooltip();
  positionHost(rect);
  t.style.display = 'block';

  if (resp.error) {
    t.innerHTML = `
      <div class="wrap">
        <button class="close-btn" title="Close">×</button>
        <div class="word">${esc(text)}</div>
        <div class="error">${esc(resp.error)}</div>
      </div>
    `;
  } else {
    const { short_def = '', contextual_explain = '', example_use = '' } = resp;
    t.innerHTML = `
      <div class="wrap">
        <button class="close-btn" title="Close">×</button>
        <div class="word">${esc(text)}</div>
        ${short_def          ? `<div class="def">${esc(short_def)}</div>` : ''}
        ${contextual_explain ? `<div class="explain">${esc(contextual_explain)}</div>` : ''}
        ${example_use        ? `<div class="example">${esc(example_use)}</div>` : ''}
      </div>
    `;
  }

  shadowRoot?.querySelector('.close-btn')?.addEventListener('click', hideTooltip);
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
  lastLookupText = '';
}

// ── Selection extraction ──────────────────────────────────────────

function getSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;

  const text = sel.toString().trim();
  if (!text || text.length > MAX_SELECTION_LENGTH) return null;

  // Walk up to the nearest block element for context
  let node: Node | null = sel.anchorNode;
  while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
  const block =
    (node as Element | null)?.closest(
      'p, div, article, section, li, td, blockquote',
    ) ?? document.body;
  const context = (
    (block as HTMLElement).innerText ?? text
  ).substring(0, MAX_CONTEXT_LENGTH);

  const range = sel.getRangeAt(0);
  const r = range.getBoundingClientRect();

  // Keep coordinates as viewport values — position:fixed uses the same space
  return {
    text,
    context,
    rect: {
      top: r.top,
      left: r.left,
      bottom: r.bottom,
      width: r.width,
    },
  };
}

// ── Event listeners ───────────────────────────────────────────────

document.addEventListener('mouseup', () => {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    if (!autoLookup) return;

    const sel = getSelection();
    if (!sel) {
      hideTooltip();
      return;
    }
    if (sel.text === lastLookupText) return; // already showing this selection
    lastLookupText = sel.text;

    showLoading(sel.text, sel.rect);

    chrome.runtime.sendMessage(
      { type: 'lookup', payload: sel },
      (resp: Record<string, string> | undefined) => {
        // Suppress the "no listener" warning when service worker is waking up
        void chrome.runtime.lastError;
        if (!resp) {
          showResult(
            sel.text,
            { error: 'No response from extension. Try reloading the page.' },
            sel.rect,
          );
          return;
        }
        showResult(sel.text, resp, sel.rect);
      },
    );
  }, DEBOUNCE_MS);
});

// Hide on click outside the tooltip
document.addEventListener('mousedown', (e) => {
  if (!tooltipHost) return;
  if (!tooltipHost.contains(e.target as Node)) hideTooltip();
});

// Hide on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTooltip();
});

// ── Utility ───────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
