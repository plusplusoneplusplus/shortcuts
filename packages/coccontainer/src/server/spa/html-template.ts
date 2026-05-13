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

    // If no built bundle exists, serve a fallback inline SPA
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
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-primary); color: var(--text-primary); }

    .header { padding: 12px 24px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 12px; background: var(--bg-secondary); }
    .header h1 { font-size: 18px; font-weight: 600; }
    .subtitle { color: var(--text-secondary); font-size: 13px; }
    .ws-status { margin-left: auto; font-size: 14px; }
    .ws-status.open { color: var(--success); }
    .ws-status.closed { color: var(--danger); }
    .ws-status.connecting { color: var(--warning); }
    .btn-back { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-back:hover { background: var(--bg-tertiary); }

    .main-content { max-width: 1200px; margin: 0 auto; padding: 20px; }

    /* Agent Management */
    .agent-management { margin-bottom: 24px; }
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .section-header h2 { font-size: 16px; }
    .add-agent-form { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .input { background: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); padding: 6px 12px; border-radius: 6px; font-size: 13px; }
    .input:focus { outline: none; border-color: var(--accent); }
    .input-name { width: 160px; }
    .btn-primary { background: #238636; color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
    .btn-primary:hover { background: #2ea043; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text-primary); padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .btn-secondary:hover { background: var(--bg-tertiary); }
    .btn-danger-sm { background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 14px; padding: 2px 6px; }
    .btn-dismiss { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; margin-left: 8px; }
    .error-banner { background: #3d1417; border: 1px solid #6e3630; color: #f85149; padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; display: flex; align-items: center; font-size: 13px; }
    .empty-state { text-align: center; color: var(--text-secondary); padding: 32px; }
    .agents-list { display: flex; flex-wrap: wrap; gap: 8px; }
    .agent-badge { display: flex; align-items: center; gap: 6px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 12px; }
    .agent-badge-name { font-weight: 500; }
    .agent-badge-address { color: var(--text-secondary); }

    /* Status dot */
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.online { background: var(--success); }
    .status-dot.offline { background: var(--danger); }
    .status-dot.unknown { background: var(--text-secondary); }

    /* Agent Cards */
    .agent-repo-view { display: flex; flex-direction: column; gap: 8px; }
    .agent-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .agent-card-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; cursor: pointer; user-select: none; }
    .agent-card-header:hover { background: var(--bg-tertiary); }
    .expand-icon { font-size: 10px; color: var(--text-secondary); width: 12px; }
    .agent-card-name { font-weight: 600; font-size: 14px; }
    .agent-card-address { color: var(--text-secondary); font-size: 12px; margin-left: auto; }
    .agent-card-count { color: var(--text-secondary); font-size: 11px; background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; }
    .agent-card-body { padding: 0 16px 12px; }

    /* Workspace list */
    .workspace-list { display: flex; flex-direction: column; gap: 4px; }
    .workspace-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--bg-tertiary); border-radius: 6px; cursor: pointer; font-size: 13px; }
    .workspace-item:hover { background: var(--bg-tertiary); }
    .workspace-item.selected { border-color: var(--accent); background: rgba(88,166,255,0.08); }
    .ws-color-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .ws-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ws-branch { font-size: 10px; padding: 1px 6px; background: var(--bg-tertiary); border-radius: 3px; color: var(--text-secondary); }

    /* Process list */
    .process-list { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
    .process-item { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .process-item:hover { background: var(--bg-tertiary); }
    .process-status { font-size: 14px; }
    .process-status.completed { color: var(--success); }
    .process-status.failed { color: var(--danger); }
    .process-status.running { color: var(--warning); }
    .process-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .process-time { color: var(--text-secondary); font-size: 11px; }

    /* Process View */
    .process-view { max-width: 900px; }
    .process-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
    .process-header h2 { font-size: 18px; }
    .process-status-badge { font-size: 11px; padding: 2px 8px; border-radius: 4px; text-transform: uppercase; font-weight: 600; }
    .process-status-badge.completed { background: #1a3a1a; color: var(--success); }
    .process-status-badge.failed { background: #3d1417; color: var(--danger); }
    .process-status-badge.running { background: #3d2e00; color: var(--warning); }
    .process-created { color: var(--text-secondary); font-size: 12px; }

    .conversation { display: flex; flex-direction: column; gap: 12px; }
    .turn { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .turn-user { border-left: 3px solid var(--accent); }
    .turn-assistant { border-left: 3px solid var(--success); }
    .turn.streaming { border-left: 3px solid var(--warning); animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
    .turn-role { font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; }
    .turn-content { font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
    .tool-calls { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
    .tool-call { margin-bottom: 6px; }
    .tool-name { font-size: 11px; font-weight: 600; color: var(--warning); }
    .tool-result { font-size: 11px; background: var(--bg-primary); padding: 6px 8px; border-radius: 4px; margin-top: 4px; overflow-x: auto; max-height: 200px; overflow-y: auto; }

    .loading-text { color: var(--text-secondary); padding: 12px; font-size: 13px; }
    .error-text { color: var(--danger); padding: 12px; font-size: 13px; }
    .empty-text { color: var(--text-secondary); padding: 12px; font-size: 13px; }
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
