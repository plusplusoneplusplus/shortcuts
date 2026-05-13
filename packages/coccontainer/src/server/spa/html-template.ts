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
      --sidebar-width: 300px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #app-root { height: 100%; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-primary); color: var(--text-primary); }

    /* ── App shell ──────────────────────────── */
    .app-shell { display: flex; flex-direction: column; height: 100%; }
    .app-body { flex: 1; display: flex; overflow: hidden; }

    /* ── Top bar ────────────────────────────── */
    .top-bar { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 48px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .top-bar-brand { display: flex; align-items: center; gap: 6px; margin-right: 8px; }
    .top-bar-logo { font-size: 18px; }
    .top-bar-title { font-weight: 600; font-size: 14px; white-space: nowrap; }

    .top-bar-agents { display: flex; align-items: center; gap: 4px; flex: 1; overflow: visible; }
    .top-bar { overflow: visible; }

    .agent-tab-wrapper { position: relative; }
    .agent-tab { display: flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text-primary); cursor: pointer; font-size: 12px; white-space: nowrap; }
    .agent-tab:hover { background: var(--bg-tertiary); }
    .agent-tab.active { border-color: var(--accent); background: rgba(88,166,255,0.1); }
    .agent-tab.open { background: var(--bg-tertiary); border-color: var(--text-secondary); }
    .agent-tab-name { font-weight: 500; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
    .agent-tab-arrow { font-size: 9px; color: var(--text-secondary); }
    .status-dot-sm { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .status-dot-sm.online { background: var(--success); }
    .status-dot-sm.offline { background: var(--danger); }
    .status-dot-sm.unknown { background: var(--text-secondary); }

    /* Repo dropdown */
    .repo-dropdown { position: absolute; top: 100%; left: 0; margin-top: 4px; min-width: 280px; max-height: 400px; overflow-y: auto; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); z-index: 100; padding: 4px; }
    .repo-dropdown-loading, .repo-dropdown-error, .repo-dropdown-empty { padding: 12px 14px; font-size: 12px; color: var(--text-secondary); }
    .repo-dropdown-error { color: var(--danger); }
    .repo-dropdown-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: none; background: transparent; color: var(--text-primary); cursor: pointer; font-size: 12px; text-align: left; border-radius: 6px; }
    .repo-dropdown-item:hover { background: var(--bg-tertiary); }
    .repo-dropdown-item.selected { background: rgba(88,166,255,0.12); }
    .repo-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .repo-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-branch { font-size: 10px; padding: 1px 5px; background: var(--bg-tertiary); border-radius: 3px; color: var(--text-secondary); }

    .top-bar-selection { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary); margin-left: auto; white-space: nowrap; }
    .selection-agent { color: var(--accent); font-weight: 500; }
    .selection-sep { color: var(--border); }
    .selection-repo { font-family: monospace; }

    .top-bar-actions { display: flex; align-items: center; gap: 4px; }
    .top-bar-btn { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 16px; padding: 4px 8px; border-radius: 4px; }
    .top-bar-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }

    /* ── Empty states ───────────────────────── */
    .empty-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-secondary); text-align: center; gap: 12px; }
    .empty-body .empty-icon { font-size: 48px; }
    .empty-body h2 { font-size: 20px; color: var(--text-primary); }
    .empty-body p { font-size: 14px; max-width: 360px; }
    .empty-detail { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); font-size: 14px; }

    /* ── Process sidebar (left) ─────────────── */
    .process-sidebar { width: var(--sidebar-width); flex-shrink: 0; background: var(--bg-secondary); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }

    .sidebar-stats { display: flex; gap: 12px; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 11px; color: var(--text-secondary); }
    .stat-value { font-weight: 600; color: var(--text-primary); }
    .stat-running .stat-value { color: var(--warning); }
    .stat-queued .stat-value { color: var(--accent); }

    .new-chat-form { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
    .new-chat-input { flex: 1; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 10px; border-radius: 6px; font-size: 12px; }
    .new-chat-input:focus { outline: none; border-color: var(--accent); }
    .new-chat-btn { background: #238636; color: white; border: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .new-chat-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .new-chat-btn:hover:not(:disabled) { background: #2ea043; }

    .sidebar-filter { margin: 6px 10px; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 5px 10px; border-radius: 6px; font-size: 11px; }
    .sidebar-filter:focus { outline: none; border-color: var(--accent); }

    .process-list-scroll { flex: 1; overflow-y: auto; padding: 4px 0; }
    .sidebar-loading-text, .sidebar-empty-text { padding: 16px 14px; color: var(--text-secondary); font-size: 12px; text-align: center; }

    .process-group { margin-bottom: 4px; }
    .process-group-header { padding: 6px 14px; font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; }
    .process-group-count { font-weight: 400; }

    .process-card { padding: 8px 14px; cursor: pointer; border-left: 3px solid transparent; }
    .process-card:hover { background: var(--bg-tertiary); }
    .process-card.selected { background: rgba(88,166,255,0.1); border-left-color: var(--accent); }
    .process-card-title { font-size: 12px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .process-card-meta { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }

    /* ── Main content (right) ───────────────── */
    .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .settings-container { flex: 1; overflow-y: auto; }

    /* ── Process detail ─────────────────────── */
    .process-detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); font-size: 14px; }
    .detail-error { color: var(--danger); }

    .detail-header { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-wrap: wrap; }
    .detail-title { font-size: 16px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-time { font-size: 11px; color: var(--text-secondary); }

    .status-badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; font-weight: 600; }
    .status-completed { background: #1a3a1a; color: var(--success); }
    .status-failed, .status-cancelled { background: #3d1417; color: var(--danger); }
    .status-running { background: #3d2e00; color: var(--warning); }
    .status-queued { background: #1a2a3d; color: var(--accent); }
    .status-unknown { background: var(--bg-tertiary); color: var(--text-secondary); }

    /* Conversation */
    .conversation-scroll { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
    .turn { border-radius: 8px; padding: 12px 16px; max-width: 100%; }
    .turn-user { background: var(--bg-secondary); border-left: 3px solid var(--accent); }
    .turn-assistant { background: var(--bg-secondary); border-left: 3px solid var(--success); }
    .turn.streaming { border-left-color: var(--warning); animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

    .turn-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .turn-role-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; }
    .turn-time { font-size: 10px; color: var(--text-secondary); margin-left: auto; }
    .streaming-indicator { font-size: 10px; color: var(--warning); margin-left: auto; animation: pulse 1.5s infinite; }
    .turn-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

    /* Tool calls */
    .tool-calls { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
    .tool-call { border-radius: 4px; }
    .tool-call-header { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 4px 0; }
    .tool-call-name { font-size: 11px; font-weight: 600; color: var(--warning); }
    .tool-call-toggle { font-size: 10px; color: var(--text-secondary); }
    .tool-call-result { font-size: 11px; background: var(--bg-primary); padding: 8px 10px; border-radius: 4px; margin-top: 4px; overflow-x: auto; max-height: 200px; overflow-y: auto; font-family: monospace; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; }

    /* Follow-up input */
    .followup-form { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--bg-secondary); }
    .followup-input { flex: 1; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    .followup-input:focus { outline: none; border-color: var(--accent); }
    .followup-btn { background: #238636; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .followup-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .followup-btn:hover:not(:disabled) { background: #2ea043; }

    /* ── Settings panel ─────────────────────── */
    .settings-panel { padding: 24px 32px; max-width: 800px; }
    .settings-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .settings-header h2 { font-size: 18px; }
    .settings-footer { margin-top: 16px; }

    .add-agent-form { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .input { background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 12px; border-radius: 6px; font-size: 13px; }
    .input:focus { outline: none; border-color: var(--accent); }
    .input-name { width: 160px; }

    .btn-primary { background: #238636; color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary:hover { background: #2ea043; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-secondary:hover { background: var(--bg-tertiary); }
    .btn-back { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-back:hover { background: var(--bg-tertiary); }
    .btn-danger-sm { background: transparent; border: 1px solid var(--danger); color: var(--danger); cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .btn-danger-sm:hover { background: rgba(248,81,73,0.1); }
    .btn-dismiss { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; margin-left: 8px; }
    .error-banner { background: #3d1417; border: 1px solid #6e3630; color: #f85149; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; display: flex; align-items: center; font-size: 13px; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.online { background: var(--success); }
    .status-dot.offline { background: var(--danger); }
    .status-dot.unknown { background: var(--text-secondary); }

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
