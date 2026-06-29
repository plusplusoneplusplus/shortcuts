/**
 * CoC Desktop — splash / loading screen (AC-03).
 *
 * A tiny, self-contained loading window shown while the embedded CoC server
 * boots. It renders to an inline `data:` URL so it needs no bundled asset file
 * (the SPA itself is always loaded over `http://127.0.0.1:<port>` — never a
 * `file://` path — this splash is the only thing rendered from local markup).
 *
 * This module imports NOTHING from `electron`, so the renderer is unit-testable
 * under plain Node/vitest.
 */

/** What the splash is currently communicating. */
export type SplashState =
    | { phase: 'loading'; message?: string }
    | { phase: 'error'; message: string };

/** Escape a string for safe interpolation into HTML text content. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Build the full HTML document for the splash window in a given state.
 * `loading` shows an animated spinner; `error` shows the failure message.
 */
export function renderSplashHtml(state: SplashState): string {
    const isError = state.phase === 'error';
    const heading = isError ? 'CoC failed to start' : 'CoC';
    const detail =
        state.phase === 'error'
            ? escapeHtml(state.message)
            : escapeHtml(state.message ?? 'Starting the local server…');
    const spinner = isError ? '' : '<div class="spinner" aria-hidden="true"></div>';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<title>CoC</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0d1117;
    color: #e6edf3;
    user-select: none;
    -webkit-user-select: none;
  }
  .brand { font-size: 28px; font-weight: 600; letter-spacing: 0.5px; }
  .detail { font-size: 13px; color: ${isError ? '#ff7b72' : '#8b949e'}; max-width: 360px; text-align: center; padding: 0 16px; }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid #30363d;
    border-top-color: #58a6ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  ${spinner}
  <div class="brand">${escapeHtml(heading)}</div>
  <div class="detail">${detail}</div>
</body>
</html>`;
}

/** Build a `data:` URL for the splash document, ready for `BrowserWindow.loadURL`. */
export function splashDataUrl(state: SplashState): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(renderSplashHtml(state))}`;
}
