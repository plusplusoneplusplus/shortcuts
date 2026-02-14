/**
 * Dashboard CSS Styles
 *
 * VS Code-inspired color scheme using CSS custom properties.
 * Light defaults with dark overrides via html[data-theme="dark"].
 */

export function getDashboardStyles(): string {
    return `        :root {
            --bg-primary: #ffffff;
            --bg-secondary: #f3f3f3;
            --bg-sidebar: #f8f8f8;
            --text-primary: #1e1e1e;
            --text-secondary: #6e6e6e;
            --border-color: #e0e0e0;
            --accent: #0078d4;
            --status-running: #0078d4;
            --status-completed: #16825d;
            --status-failed: #f14c4c;
            --status-cancelled: #e8912d;
            --status-queued: #848484;
            --topbar-bg: #18181b;
            --topbar-text: #ffffff;
            --hover-bg: rgba(0,0,0,0.04);
            --active-bg: rgba(0,120,212,0.08);
        }

        html[data-theme="dark"] {
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --bg-sidebar: #1e1e1e;
            --text-primary: #cccccc;
            --text-secondary: #858585;
            --border-color: #3c3c3c;
            --accent: #0078d4;
            --status-running: #3794ff;
            --status-completed: #89d185;
            --status-failed: #f48771;
            --status-cancelled: #cca700;
            --status-queued: #848484;
            --hover-bg: rgba(255,255,255,0.04);
            --active-bg: rgba(0,120,212,0.15);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5;
            overflow: hidden;
            height: 100vh;
        }

        .hidden { display: none !important; }

        /* ---- Top Bar ---- */
        .top-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 48px;
            padding: 0 16px;
            background: var(--topbar-bg);
            color: var(--topbar-text);
            border-bottom: 1px solid var(--border-color);
            z-index: 100;
            position: relative;
        }
        .top-bar-left { display: flex; align-items: center; gap: 12px; }
        .top-bar-logo { font-weight: 600; font-size: 14px; letter-spacing: 0.3px; }
        .top-bar-right { display: flex; align-items: center; gap: 8px; }
        .top-bar-btn {
            background: transparent;
            border: 1px solid rgba(255,255,255,0.15);
            color: var(--topbar-text);
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 16px;
            line-height: 1;
            transition: background-color 0.15s;
        }
        .top-bar-btn:hover { background: rgba(255,255,255,0.1); }
        .workspace-select {
            background: rgba(255,255,255,0.1);
            color: var(--topbar-text);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 13px;
            cursor: pointer;
            max-width: 200px;
        }
        .workspace-select option { background: var(--bg-primary); color: var(--text-primary); }
        .hamburger-btn {
            display: none;
            background: transparent;
            border: none;
            color: var(--topbar-text);
            font-size: 20px;
            cursor: pointer;
            padding: 4px 8px;
        }

        /* ---- App Layout ---- */
        .app-layout {
            display: grid;
            grid-template-columns: 320px 1fr;
            height: calc(100vh - 48px);
        }

        /* ---- Sidebar ---- */
        .sidebar {
            background: var(--bg-sidebar);
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .filter-bar {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            border-bottom: 1px solid var(--border-color);
        }
        .filter-bar input,
        .filter-bar select {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 13px;
        }
        .filter-bar input:focus,
        .filter-bar select:focus {
            outline: none;
            border-color: var(--accent);
        }
        .process-list {
            flex: 1;
            overflow-y: auto;
            padding: 4px 0;
        }

        /* ---- Status Group Headers ---- */
        .status-group-header {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--text-secondary);
            letter-spacing: 0.5px;
        }
        .status-group-count {
            background: var(--bg-secondary);
            border-radius: 10px;
            padding: 1px 6px;
            font-size: 10px;
            font-weight: 500;
        }

        /* ---- Process Items ---- */
        .process-item {
            display: flex;
            flex-direction: column;
            padding: 8px 12px;
            border-left: 3px solid transparent;
            cursor: pointer;
            transition: background-color 0.15s, border-color 0.15s;
        }
        .process-item:hover { background: var(--hover-bg); }
        .process-item.active {
            background: var(--active-bg);
            border-left-color: var(--accent);
        }
        .process-item.child-item {
            padding-left: 36px;
            border-left-width: 2px;
        }
        .process-item-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .process-item .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .status-dot.running { background: var(--status-running); }
        .status-dot.completed { background: var(--status-completed); }
        .status-dot.failed { background: var(--status-failed); }
        .status-dot.cancelled { background: var(--status-cancelled); }
        .status-dot.queued { background: var(--status-queued); }
        .process-item .title {
            flex: 1;
            font-size: 13px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .process-item .meta {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 2px;
            padding-left: 16px;
        }
        .type-badge {
            font-size: 10px;
            padding: 1px 6px;
            border-radius: 3px;
            background: var(--bg-secondary);
            color: var(--text-secondary);
            white-space: nowrap;
        }
        .time-label {
            font-size: 11px;
            color: var(--text-secondary);
        }
        .expand-chevron {
            cursor: pointer;
            font-size: 10px;
            transition: transform 0.15s;
            color: var(--text-secondary);
            flex-shrink: 0;
            padding: 2px;
        }
        .expand-chevron.expanded { transform: rotate(90deg); }

        /* ---- Sidebar Footer ---- */
        .sidebar-footer {
            padding: 8px 12px;
            border-top: 1px solid var(--border-color);
        }
        .sidebar-btn {
            width: 100%;
            padding: 6px 12px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 12px;
            cursor: pointer;
            transition: background-color 0.15s;
        }
        .sidebar-btn:hover { background: var(--hover-bg); }

        /* ---- Empty State ---- */
        .empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
            color: var(--text-secondary);
        }
        .empty-state-icon { font-size: 32px; margin-bottom: 12px; }
        .empty-state-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; color: var(--text-primary); }
        .empty-state-text { font-size: 12px; }

        /* ---- Detail Panel ---- */
        .detail-panel {
            overflow-y: auto;
            padding: 24px;
            background: var(--bg-primary);
        }
        .detail-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-secondary);
        }
        .detail-empty-icon { font-size: 48px; margin-bottom: 12px; }
        .detail-empty-text { font-size: 14px; }
        .detail-content { max-width: 800px; margin: 0 auto; }
        .detail-header { margin-bottom: 20px; }
        .detail-header h1 {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .detail-header .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        .status-badge.running { background: rgba(0,120,212,0.12); color: var(--status-running); }
        .status-badge.completed { background: rgba(22,130,93,0.12); color: var(--status-completed); }
        .status-badge.failed { background: rgba(241,76,76,0.12); color: var(--status-failed); }
        .status-badge.cancelled { background: rgba(232,145,45,0.12); color: var(--status-cancelled); }
        .status-badge.queued { background: rgba(132,132,132,0.12); color: var(--status-queued); }

        /* ---- Metadata Grid ---- */
        .meta-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 12px;
            margin-bottom: 20px;
            padding: 16px;
            background: var(--bg-secondary);
            border-radius: 8px;
        }
        .meta-item label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--text-secondary);
            margin-bottom: 2px;
            letter-spacing: 0.3px;
        }
        .meta-item span { font-size: 13px; }

        /* ---- Result Section ---- */
        .result-section { margin-bottom: 20px; }
        .result-section h2 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .result-body {
            padding: 16px;
            background: var(--bg-secondary);
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.6;
        }

        /* ---- Markdown Rendering ---- */
        .result-body h1,
        .result-body h2,
        .result-body h3,
        .result-body h4 {
            margin-top: 16px;
            margin-bottom: 8px;
            font-weight: 600;
        }
        .result-body h1 { font-size: 20px; }
        .result-body h2 { font-size: 17px; }
        .result-body h3 { font-size: 15px; }
        .result-body h4 { font-size: 14px; }
        .result-body p { margin-bottom: 8px; }
        .result-body ul, .result-body ol { margin: 8px 0; padding-left: 24px; }
        .result-body li { margin-bottom: 4px; }
        .result-body blockquote {
            border-left: 3px solid var(--accent);
            padding: 4px 12px;
            margin: 8px 0;
            color: var(--text-secondary);
        }
        .result-body code {
            background: var(--bg-primary);
            padding: 2px 5px;
            border-radius: 3px;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 0.9em;
        }
        .result-body pre {
            background: var(--bg-primary);
            padding: 12px 16px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
        }
        .result-body pre code {
            background: transparent;
            padding: 0;
        }
        .result-body a { color: var(--accent); text-decoration: none; }
        .result-body a:hover { text-decoration: underline; }
        .result-body hr {
            border: none;
            border-top: 1px solid var(--border-color);
            margin: 16px 0;
        }

        /* ---- Collapsible Prompt ---- */
        .prompt-section { margin-bottom: 20px; }
        .prompt-section summary {
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            padding: 8px 0;
            user-select: none;
            list-style: none;
        }
        .prompt-section summary::before {
            content: '\\25B6';
            display: inline-block;
            margin-right: 6px;
            font-size: 10px;
            transition: transform 0.15s;
        }
        .prompt-section[open] summary::before {
            transform: rotate(90deg);
        }
        .prompt-body {
            padding: 12px 16px;
            background: var(--bg-secondary);
            border-radius: 8px;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 400px;
            overflow-y: auto;
        }

        /* ---- Error Alert ---- */
        .error-alert {
            padding: 12px 16px;
            background: rgba(241,76,76,0.08);
            border: 1px solid rgba(241,76,76,0.2);
            border-radius: 8px;
            color: var(--status-failed);
            margin-bottom: 20px;
            font-size: 13px;
        }

        /* ---- Action Buttons ---- */
        .action-buttons {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
        }
        .action-btn {
            padding: 6px 14px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 12px;
            cursor: pointer;
            transition: background-color 0.15s;
        }
        .action-btn:hover { background: var(--hover-bg); }

        /* ---- Child Summary Table ---- */
        .child-summary { margin-bottom: 20px; }
        .child-summary h2 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }
        .child-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .child-table th,
        .child-table td {
            padding: 6px 10px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }
        .child-table th {
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            color: var(--text-secondary);
        }
        .child-table tr { cursor: pointer; transition: background-color 0.15s; }
        .child-table tr:hover { background: var(--hover-bg); }

        /* ---- Scrollbar ---- */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: var(--border-color);
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: var(--text-secondary);
        }

        /* ---- Queue Panel ---- */
        .queue-panel {
            border-bottom: 1px solid var(--border-color);
        }
        .queue-panel:empty {
            display: none;
        }
        .queue-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: var(--bg-secondary);
        }
        .queue-header-left {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .queue-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--text-secondary);
            letter-spacing: 0.5px;
        }
        .queue-count {
            background: var(--accent);
            color: #fff;
            border-radius: 10px;
            padding: 0 6px;
            font-size: 10px;
            font-weight: 600;
            min-width: 18px;
            text-align: center;
            line-height: 18px;
        }
        .queue-paused-badge {
            background: var(--status-cancelled);
            color: #fff;
            border-radius: 3px;
            padding: 1px 5px;
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .queue-header-right {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .queue-ctrl-btn {
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 12px;
            line-height: 1;
            transition: background-color 0.15s, color 0.15s;
        }
        .queue-ctrl-btn:hover {
            background: var(--hover-bg);
            color: var(--text-primary);
        }
        .queue-ctrl-danger:hover {
            background: rgba(241,76,76,0.1);
            color: var(--status-failed);
        }
        .queue-section-label {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 12px 2px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--text-secondary);
            letter-spacing: 0.3px;
        }
        .queue-section-count {
            font-size: 9px;
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 0 5px;
        }
        .queue-task {
            padding: 6px 12px;
            border-left: 3px solid transparent;
            transition: background-color 0.15s;
        }
        .queue-task:hover {
            background: var(--hover-bg);
        }
        .queue-task.running {
            border-left-color: var(--status-running);
        }
        .queue-task.queued {
            border-left-color: var(--status-queued);
        }
        .queue-task-row {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
        }
        .queue-task-status {
            flex-shrink: 0;
            font-size: 11px;
        }
        .queue-task-priority {
            flex-shrink: 0;
            font-size: 10px;
        }
        .queue-task-name {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--text-primary);
        }
        .queue-task-time {
            flex-shrink: 0;
            font-size: 10px;
            color: var(--text-secondary);
        }
        .queue-task-actions {
            display: flex;
            gap: 4px;
            margin-top: 3px;
            padding-left: 20px;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .queue-task:hover .queue-task-actions {
            opacity: 1;
        }
        .queue-action-btn {
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            cursor: pointer;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 10px;
            line-height: 1.2;
            transition: background-color 0.15s, color 0.15s;
        }
        .queue-action-btn:hover {
            background: var(--hover-bg);
            color: var(--text-primary);
        }
        .queue-action-danger:hover {
            background: rgba(241,76,76,0.1);
            color: var(--status-failed);
        }
        .queue-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 12px;
            gap: 8px;
        }
        .queue-empty-text {
            font-size: 11px;
            color: var(--text-secondary);
        }
        .queue-add-btn {
            background: var(--accent);
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 4px 12px;
            font-size: 11px;
            cursor: pointer;
            transition: opacity 0.15s;
        }
        .queue-add-btn:hover {
            opacity: 0.85;
        }

        /* ---- Queue History ---- */
        .queue-history-toggle {
            cursor: pointer;
            user-select: none;
            margin-top: 4px;
            border-top: 1px solid var(--border-color);
            padding-top: 6px;
        }
        .queue-history-toggle:hover {
            color: var(--text-primary);
        }
        .queue-history-clear {
            margin-left: auto;
            font-size: 10px;
            padding: 1px 4px;
        }
        .queue-history-task {
            opacity: 0.75;
        }
        .queue-history-task:hover {
            opacity: 1;
        }
        .queue-task.completed {
            border-left-color: var(--status-completed);
        }
        .queue-task.failed {
            border-left-color: var(--status-failed);
        }
        .queue-task.cancelled {
            border-left-color: var(--text-secondary);
        }
        .queue-task-error {
            font-size: 10px;
            color: var(--status-failed);
            padding: 2px 0 0 22px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ---- Enqueue Dialog ---- */
        .enqueue-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 200;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .enqueue-dialog {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            width: 420px;
            max-width: 90vw;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        }
        .enqueue-dialog-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px 12px;
            border-bottom: 1px solid var(--border-color);
        }
        .enqueue-dialog-header h2 {
            font-size: 15px;
            font-weight: 600;
            margin: 0;
        }
        .enqueue-close-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-size: 20px;
            cursor: pointer;
            padding: 0 4px;
            line-height: 1;
        }
        .enqueue-close-btn:hover {
            color: var(--text-primary);
        }
        .enqueue-form {
            padding: 16px 20px 20px;
        }
        .enqueue-field {
            margin-bottom: 12px;
        }
        .enqueue-field label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-secondary);
            margin-bottom: 4px;
        }
        .enqueue-optional {
            font-weight: 400;
            font-size: 11px;
            opacity: 0.7;
        }
        .enqueue-field input,
        .enqueue-field select,
        .enqueue-field textarea {
            width: 100%;
            padding: 7px 10px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--bg-secondary);
            color: var(--text-primary);
            font-size: 13px;
            font-family: inherit;
        }
        .enqueue-field input:focus,
        .enqueue-field select:focus,
        .enqueue-field textarea:focus {
            outline: none;
            border-color: var(--accent);
        }
        .enqueue-field textarea {
            resize: vertical;
            min-height: 60px;
        }
        .enqueue-field-row {
            display: flex;
            gap: 12px;
        }
        .enqueue-field-row .enqueue-field {
            flex: 1;
        }
        .enqueue-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 16px;
        }
        .enqueue-btn-primary {
            background: var(--accent);
            color: #fff;
            border: none;
            border-radius: 4px;
            padding: 7px 16px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: opacity 0.15s;
        }
        .enqueue-btn-primary:hover {
            opacity: 0.85;
        }
        .enqueue-btn-secondary {
            background: var(--bg-secondary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 7px 16px;
            font-size: 13px;
            cursor: pointer;
            transition: background-color 0.15s;
        }
        .enqueue-btn-secondary:hover {
            background: var(--hover-bg);
        }

        /* ---- Queue Task Conversation View ---- */
        .detail-header-top {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .detail-back-btn {
            background: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            cursor: pointer;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1.2;
            transition: background-color 0.15s, color 0.15s;
        }
        .detail-back-btn:hover {
            background: var(--hover-bg);
            color: var(--text-primary);
        }
        .conversation-section {
            margin-top: 16px;
        }
        .conversation-section h2 {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 8px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .streaming-indicator {
            font-size: 10px;
            color: var(--status-running);
            animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }
        .conversation-body {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 16px;
            min-height: 200px;
            max-height: 60vh;
            overflow-y: auto;
            font-size: 13px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .conversation-body pre {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 12px;
            overflow-x: auto;
            margin: 8px 0;
        }
        .conversation-body code {
            font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
            font-size: 12px;
        }
        .conversation-body p {
            margin: 4px 0;
        }
        .conversation-body h1, .conversation-body h2, .conversation-body h3, .conversation-body h4 {
            margin: 12px 0 6px 0;
        }
        .conversation-body ul, .conversation-body ol {
            margin: 4px 0;
            padding-left: 20px;
        }
        .conversation-body blockquote {
            border-left: 3px solid var(--accent);
            margin: 8px 0;
            padding: 4px 12px;
            color: var(--text-secondary);
        }
        .conversation-waiting {
            color: var(--text-secondary);
            font-style: italic;
            padding: 20px 0;
            text-align: center;
        }

        /* ---- Responsive ---- */
        @media (max-width: 768px) {
            .hamburger-btn { display: block; }
            .app-layout { grid-template-columns: 1fr; }
            .sidebar {
                position: fixed;
                top: 48px;
                left: 0;
                width: 100%;
                height: calc(100vh - 48px);
                z-index: 50;
                transform: translateX(-100%);
                transition: transform 0.2s;
            }
            .sidebar.open {
                transform: translateX(0);
            }
            .detail-panel { padding: 16px; }
        }
`;
}
