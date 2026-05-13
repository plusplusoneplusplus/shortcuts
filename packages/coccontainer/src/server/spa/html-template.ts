/**
 * SPA HTML Template
 *
 * Generates the dashboard HTML with inlined CSS and JS bundles.
 */

import * as fs from 'fs';
import * as path from 'path';

const bundleCssPath = path.join(__dirname, 'client', 'dist', 'bundle.css');
const bundleJsPath = path.join(__dirname, 'client', 'dist', 'bundle.js');

let cachedCss: string | null = null;
let cachedJs: string | null = null;

function readBundle(filePath: string): string {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}

export function generateDashboardHtml(): string {
    if (!cachedCss) cachedCss = readBundle(bundleCssPath);
    if (!cachedJs) cachedJs = readBundle(bundleJsPath);

    const hasBundle = !!cachedJs;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoCContainer Dashboard</title>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --border: #30363d;
      --text-primary: #c9d1d9;
      --text-secondary: #8b949e;
      --accent: #58a6ff;
      --success: #3fb950;
      --danger: #f85149;
      --warning: #d29922;
      --sidebar-width: 260px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #app-root { height: 100%; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-primary); color: var(--text-primary); }

    /* ── Two-panel layout ───────────────────── */
    .container-layout { display: flex; height: 100%; }

    /* ── Sidebar ────────────────────────────── */
    .sidebar { width: var(--sidebar-width); flex-shrink: 0; background: var(--bg-secondary); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
    .sidebar-header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--border); }
    .sidebar-logo { font-size: 18px; }
    .sidebar-title { font-weight: 600; font-size: 14px; flex: 1; }
    .sidebar-settings-btn { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 4px; }
    .sidebar-settings-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

    .sidebar-agents { flex: 1; overflow-y: auto; padding: 6px 0; }
    .sidebar-loading, .sidebar-empty { padding: 16px 14px; color: var(--text-secondary); font-size: 13px; text-align: center; }
    .sidebar-empty p { margin-bottom: 8px; }

    .sidebar-agent { border-bottom: 1px solid var(--border); }
    .sidebar-agent:last-child { border-bottom: none; }

    .sidebar-agent-row { display: flex; align-items: center; gap: 6px; padding: 8px 14px; cursor: pointer; font-size: 13px; user-select: none; }
    .sidebar-agent-row:hover { background: var(--bg-tertiary); }
    .sidebar-agent-row.active { background: rgba(88,166,255,0.1); }
    .sidebar-expand-icon { width: 12px; font-size: 10px; color: var(--text-secondary); flex-shrink: 0; }
    .sidebar-agent-name { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sidebar-count { font-size: 10px; color: var(--text-secondary); background: var(--bg-tertiary); padding: 1px 5px; border-radius: 3px; }

    .sidebar-workspaces { padding: 2px 0 4px 0; }
    .sidebar-ws-loading, .sidebar-ws-error, .sidebar-ws-empty { padding: 4px 14px 4px 34px; font-size: 11px; color: var(--text-secondary); }
    .sidebar-ws-error { color: var(--danger); }

    .sidebar-ws-item { display: flex; align-items: center; gap: 6px; padding: 5px 14px 5px 34px; cursor: pointer; font-size: 12px; border-left: 2px solid transparent; }
    .sidebar-ws-item:hover { background: var(--bg-tertiary); }
    .sidebar-ws-item.active { background: rgba(88,166,255,0.1); border-left-color: var(--accent); }
    .sidebar-ws-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .sidebar-ws-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sidebar-ws-branch { font-size: 9px; padding: 1px 4px; background: var(--bg-tertiary); border-radius: 3px; color: var(--text-secondary); }

    /* ── Main panel ─────────────────────────── */
    .main-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

    /* Empty state */
    .empty-main { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); text-align: center; gap: 12px; }
    .empty-main .empty-icon { font-size: 48px; }
    .empty-main h2 { font-size: 20px; color: var(--text-primary); }
    .empty-main p { font-size: 14px; max-width: 360px; }

    /* Iframe wrapper */
    .iframe-wrapper { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .iframe-bar { display: flex; align-items: center; gap: 8px; padding: 6px 14px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); font-size: 12px; }
    .iframe-agent-name { font-weight: 600; color: var(--accent); }
    .iframe-workspace-name { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .iframe-open-link { margin-left: auto; color: var(--text-secondary); text-decoration: none; font-size: 14px; padding: 2px 6px; border-radius: 4px; }
    .iframe-open-link:hover { background: var(--bg-tertiary); color: var(--text-primary); }
    .agent-iframe { flex: 1; border: none; width: 100%; background: var(--bg-primary); }

    /* ── Settings panel ─────────────────────── */
    .settings-panel { padding: 24px 32px; max-width: 800px; overflow-y: auto; flex: 1; }
    .settings-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .settings-header h2 { font-size: 18px; }
    .settings-footer { margin-top: 16px; }

    /* ── Shared components ───────────────────── */
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.online { background: var(--success); }
    .status-dot.offline { background: var(--danger); }
    .status-dot.unknown { background: var(--text-secondary); }

    .add-agent-form { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .input { background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 12px; border-radius: 6px; font-size: 13px; }
    .input:focus { outline: none; border-color: var(--accent); }
    .input-name { width: 160px; }

    .btn-primary { background: #238636; color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary:hover { background: #2ea043; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }
    .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-secondary:hover { background: var(--bg-tertiary); }
    .btn-back { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-back:hover { background: var(--bg-tertiary); }
    .btn-danger-sm { background: transparent; border: 1px solid var(--danger); color: var(--danger); cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .btn-danger-sm:hover { background: rgba(248,81,73,0.1); }
    .btn-dismiss { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; margin-left: 8px; }

    .error-banner { background: #3d1417; border: 1px solid #6e3630; color: #f85149; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; display: flex; align-items: center; font-size: 13px; }

    /* Agent table */
    .agent-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .agent-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-weight: 500; font-size: 11px; text-transform: uppercase; }
    .agent-table td { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .agent-table-empty { text-align: center; color: var(--text-secondary); padding: 24px !important; }
    .agent-table-name { font-weight: 500; }
    .agent-table-addr { color: var(--text-secondary); font-family: monospace; font-size: 12px; }
    .agent-table-time { color: var(--text-secondary); font-size: 12px; }

    ${cachedCss || ''}
  </style>
</head>
<body>
  <div id="app-root"></div>
  <script>${hasBundle ? cachedJs : getFallbackScript()}</script>
</body>
</html>`;
}

function getFallbackScript(): string {
    // Minimal fallback if the React bundle hasn't been built
    return `
        document.getElementById('app-root').innerHTML = '<div style="padding:40px;text-align:center;color:#8b949e">' +
            '<h1 style="color:#c9d1d9">🔗 CoCContainer</h1>' +
            '<p style="margin-top:12px">React SPA not built. Run <code>npm run build:client</code> in packages/coccontainer/</p>' +
            '</div>';
    `;
}
