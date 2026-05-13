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
      --bg-primary: #ffffff;
      --bg-secondary: #f6f8fa;
      --bg-tertiary: #eaeef2;
      --border: #d0d7de;
      --border-light: #e1e4e8;
      --text-primary: #1f2328;
      --text-secondary: #656d76;
      --accent: #0969da;
      --accent-bg: #ddf4ff;
      --success: #1a7f37;
      --danger: #cf222e;
      --warning: #9a6700;
      --sidebar-width: 260px;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #app-root { height: 100%; overflow: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-primary); color: var(--text-primary); font-size: 14px; }

    /* ── App shell ──────────────────────────── */
    .app-shell { display: flex; flex-direction: column; height: 100%; }
    .app-body { flex: 1; display: flex; overflow: hidden; }

    /* ── Top bar (matches CoC) ──────────────── */
    .top-bar { display: flex; align-items: center; gap: 0; height: 40px; background: var(--bg-secondary); border-bottom: 1px solid var(--border); flex-shrink: 0; padding: 0 12px; overflow: visible; }
    .top-bar-hamburger { background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px 8px; color: var(--text-secondary); border-radius: 4px; }
    .top-bar-hamburger:hover { background: var(--bg-tertiary); }
    .top-bar-brand { font-weight: 600; font-size: 13px; margin: 0 12px 0 4px; white-space: nowrap; color: var(--text-primary); }

    /* Repo tab strip */
    .repo-tab-strip { display: flex; align-items: center; gap: 2px; flex: 1; overflow: visible; }
    .repo-tab { display: flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 12px; color: var(--text-primary); white-space: nowrap; font-weight: 500; }
    .repo-tab:hover { background: var(--bg-tertiary); }
    .repo-tab.selected { background: var(--accent); color: #fff; }
    .repo-tab-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.1); }
    .repo-tab-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }

    /* Add button + dropdown */
    .add-menu-wrapper { position: relative; margin-left: 4px; }
    .add-btn { display: flex; align-items: center; gap: 2px; padding: 4px 8px; border-radius: 6px; border: none; background: transparent; cursor: pointer; font-size: 14px; color: var(--text-secondary); font-weight: 600; }
    .add-btn:hover { background: var(--bg-tertiary); }
    .add-btn-arrow { font-size: 9px; }
    .add-dropdown { position: absolute; top: 100%; left: 0; margin-top: 4px; min-width: 220px; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 200; padding: 4px; }
    .add-dropdown-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; border: none; background: transparent; cursor: pointer; font-size: 13px; color: var(--text-primary); text-align: left; border-radius: 6px; }
    .add-dropdown-item:hover { background: var(--bg-tertiary); }
    .add-dropdown-icon { width: 20px; text-align: center; font-size: 14px; }
    .add-dropdown-divider { height: 1px; background: var(--border-light); margin: 4px 8px; }

    /* Right actions */
    .top-bar-right { display: flex; align-items: center; gap: 4px; margin-left: auto; }
    .top-bar-action-btn { background: none; border: none; font-size: 16px; cursor: pointer; padding: 4px 8px; color: var(--text-secondary); border-radius: 4px; }
    .top-bar-action-btn:hover { background: var(--bg-tertiary); }

    /* ── Sub-tab bar ────────────────────────── */
    .sub-tab-bar { display: flex; align-items: center; gap: 12px; padding: 0 16px; height: 36px; background: var(--bg-primary); border-bottom: 1px solid var(--border); width: 100%; flex-shrink: 0; }
    .sub-tab-repo-name { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14px; margin-right: 12px; }
    .sub-tab-dot { width: 8px; height: 8px; border-radius: 50%; }
    .sub-tab { font-size: 13px; color: var(--text-secondary); cursor: pointer; padding: 6px 0; border-bottom: 2px solid transparent; }
    .sub-tab:hover { color: var(--text-primary); }
    .sub-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 500; }
    .sub-tab-agent-badge { margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--bg-tertiary); color: var(--text-secondary); }

    /* ── Empty states ───────────────────────── */
    .empty-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-secondary); text-align: center; gap: 8px; }
    .empty-chat-icon { font-size: 40px; opacity: 0.4; }
    .empty-body h2 { font-size: 18px; color: var(--text-primary); font-weight: 500; }
    .empty-body p { font-size: 13px; max-width: 300px; }
    .empty-detail { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); text-align: center; gap: 6px; }
    .empty-detail-sub { font-size: 12px; }

    /* ── Process sidebar (left) ─────────────── */
    .process-sidebar { width: var(--sidebar-width); flex-shrink: 0; background: var(--bg-primary); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }

    .sidebar-stats { display: flex; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--border-light); font-size: 11px; color: var(--text-secondary); }
    .stat-value { font-weight: 600; color: var(--text-primary); }
    .stat-running .stat-value { color: var(--warning); }
    .stat-queued .stat-value { color: var(--accent); }

    .new-chat-form { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border-light); }
    .new-chat-input { flex: 1; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 10px; border-radius: 6px; font-size: 12px; }
    .new-chat-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
    .new-chat-btn { background: var(--accent); color: #fff; border: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .new-chat-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .new-chat-btn:hover:not(:disabled) { background: #0860ca; }

    .sidebar-filter { margin: 6px 10px; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 5px 10px; border-radius: 6px; font-size: 11px; }
    .sidebar-filter:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }

    .process-list-scroll { flex: 1; overflow-y: auto; padding: 4px 0; }
    .sidebar-loading-text, .sidebar-empty-text { padding: 16px 14px; color: var(--text-secondary); font-size: 12px; text-align: center; }

    .process-group { margin-bottom: 4px; }
    .process-group-header { padding: 6px 14px; font-size: 10px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
    .process-group-count { font-weight: 400; }

    .process-card { padding: 8px 14px; cursor: pointer; border-left: 3px solid transparent; }
    .process-card:hover { background: var(--bg-tertiary); }
    .process-card.selected { background: var(--accent-bg); border-left-color: var(--accent); }
    .process-card-title { font-size: 12px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .process-card-meta { font-size: 10px; color: var(--text-secondary); margin-top: 2px; }

    /* ── Main content (right) ───────────────── */
    .main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .settings-container { flex: 1; overflow-y: auto; }

    /* ── Process detail ─────────────────────── */
    .process-detail { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .detail-placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); font-size: 14px; }
    .detail-error { color: var(--danger); }

    .detail-header { display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-bottom: 1px solid var(--border); background: var(--bg-secondary); flex-wrap: wrap; }
    .detail-title { font-size: 15px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .detail-time { font-size: 11px; color: var(--text-secondary); }

    .status-badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; font-weight: 600; }
    .status-completed { background: #dafbe1; color: var(--success); }
    .status-failed, .status-cancelled { background: #ffebe9; color: var(--danger); }
    .status-running { background: #fff8c5; color: var(--warning); }
    .status-queued { background: var(--accent-bg); color: var(--accent); }
    .status-unknown { background: var(--bg-tertiary); color: var(--text-secondary); }

    .conversation-scroll { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }
    .turn { border-radius: 8px; padding: 12px 16px; }
    .turn-user { background: var(--accent-bg); border-left: 3px solid var(--accent); }
    .turn-assistant { background: var(--bg-secondary); border-left: 3px solid var(--success); }
    .turn.streaming { border-left-color: var(--warning); animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }

    .turn-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .turn-role-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; }
    .turn-time { font-size: 10px; color: var(--text-secondary); margin-left: auto; }
    .streaming-indicator { font-size: 10px; color: var(--warning); margin-left: auto; animation: pulse 1.5s infinite; }
    .turn-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

    .tool-calls { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-light); display: flex; flex-direction: column; gap: 4px; }
    .tool-call-header { display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 4px 0; }
    .tool-call-name { font-size: 11px; font-weight: 600; color: var(--warning); }
    .tool-call-toggle { font-size: 10px; color: var(--text-secondary); }
    .tool-call-result { font-size: 11px; background: var(--bg-tertiary); padding: 8px 10px; border-radius: 4px; margin-top: 4px; overflow-x: auto; max-height: 200px; overflow-y: auto; font-family: monospace; color: var(--text-secondary); white-space: pre-wrap; word-break: break-all; }

    .followup-form { display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); background: var(--bg-secondary); }
    .followup-input { flex: 1; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    .followup-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
    .followup-btn { background: var(--accent); color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .followup-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .followup-btn:hover:not(:disabled) { background: #0860ca; }

    /* ── Dialog (modal) ─────────────────────── */
    .dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 300; display: flex; align-items: center; justify-content: center; }
    .dialog { background: var(--bg-primary); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,0.2); width: 420px; max-width: 90vw; padding: 24px; }
    .dialog-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .dialog-header h2 { font-size: 18px; font-weight: 600; }
    .dialog-close { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-secondary); padding: 2px 6px; border-radius: 4px; }
    .dialog-close:hover { background: var(--bg-tertiary); }
    .dialog-label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 6px; margin-top: 14px; color: var(--text-primary); }
    .dialog-label:first-of-type { margin-top: 0; }
    .dialog-input { width: 100%; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
    .dialog-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
    .dialog-select { width: 100%; background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; font-size: 13px; appearance: auto; }
    .dialog-select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(9,105,218,0.15); }
    .dialog-path-row { display: flex; gap: 6px; }
    .dialog-path-row .dialog-input { flex: 1; }
    .dialog-browse-btn { background: var(--bg-secondary); border: 1px solid var(--border); color: var(--text-primary); padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; white-space: nowrap; }
    .dialog-browse-btn:hover { background: var(--bg-tertiary); }
    .dialog-error { margin-top: 12px; padding: 8px 12px; background: #ffebe9; border: 1px solid #ffcecb; color: var(--danger); border-radius: 6px; font-size: 12px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
    .dialog-btn-cancel { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .dialog-btn-cancel:hover { background: var(--bg-tertiary); }
    .dialog-btn-primary { background: var(--accent); color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .dialog-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .dialog-btn-primary:hover:not(:disabled) { background: #0860ca; }

    /* Color picker */
    .color-picker { display: flex; gap: 6px; margin-top: 4px; }
    .color-swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
    .color-swatch:hover { opacity: 0.8; }
    .color-swatch.selected { border-color: var(--text-primary); box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--text-secondary); }

    /* ── Settings panel ─────────────────────── */
    .settings-panel { padding: 24px 32px; max-width: 800px; }
    .settings-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    .settings-header h2 { font-size: 18px; }
    .settings-footer { margin-top: 16px; }
    .add-agent-form { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .input { background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 12px; border-radius: 6px; font-size: 13px; }
    .input:focus { outline: none; border-color: var(--accent); }
    .input-name { width: 160px; }
    .btn-primary { background: var(--accent); color: #fff; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary:hover { background: #0860ca; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-secondary:hover { background: var(--bg-tertiary); }
    .btn-back { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-back:hover { background: var(--bg-tertiary); }
    .btn-danger-sm { background: transparent; border: 1px solid var(--danger); color: var(--danger); cursor: pointer; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .btn-danger-sm:hover { background: #ffebe9; }
    .btn-dismiss { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; margin-left: 8px; }
    .error-banner { background: #ffebe9; border: 1px solid #ffcecb; color: var(--danger); padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; display: flex; align-items: center; font-size: 13px; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.online { background: var(--success); }
    .status-dot.offline { background: var(--danger); }
    .status-dot.unknown { background: var(--text-secondary); }
    .agent-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .agent-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-weight: 500; font-size: 11px; text-transform: uppercase; }
    .agent-table td { padding: 8px 12px; border-bottom: 1px solid var(--border-light); }
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
