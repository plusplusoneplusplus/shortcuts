/**
 * Pipeline Result Viewer Content Generator
 *
 * Generates HTML content for the Pipeline Result Viewer webview panel.
 * Displays individual result nodes that can be clicked to see full details.
 * Reuses styling patterns from preview-content.ts for consistency.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import {
    PipelineResultViewData,
    PipelineItemResultNode,
    ResultViewerMessage,
    formatDuration,
    getStatusIcon,
    getStatusClass,
    getItemPreview
} from './result-viewer-types';

/**
 * Generate HTML content for the Pipeline Result Viewer webview
 */
export function getResultViewerContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    data?: PipelineResultViewData
): string {
    const nonce = getNonce();
    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Pipeline Results</title>
    <style>
        ${getStyles(isDark)}
    </style>
</head>
<body class="${isDark ? 'vscode-dark' : 'vscode-light'}">
    <div class="container">
        ${data ? getContentWithData(data, isDark) : getEmptyContent()}
    </div>
    <script nonce="${nonce}">
        ${getScript(data)}
    </script>
</body>
</html>`;
}

/**
 * Generate content when result data is available
 */
function getContentWithData(data: PipelineResultViewData, isDark: boolean): string {
    return `
        ${getToolbar(data)}
        ${getHeader(data)}
        ${getSummarySection(data)}
        ${getResultsGrid(data)}
        ${getDetailsPanel(data)}
    `;
}

/**
 * Generate content when no results are available
 */
function getEmptyContent(): string {
    return `
        <div class="empty-state">
            <div class="empty-icon">📊</div>
            <h3>No Results Available</h3>
            <p>Execute a pipeline to view results here.</p>
        </div>
    `;
}

/**
 * Generate toolbar section
 */
function getToolbar(data: PipelineResultViewData): string {
    return `
        <div class="toolbar">
            <div class="toolbar-left">
                <span class="filter-label">Filter:</span>
                <button class="filter-btn active" data-filter="all">All (${data.itemResults.length})</button>
                <button class="filter-btn" data-filter="success">✅ Success (${data.itemResults.filter(r => r.success).length})</button>
                <button class="filter-btn" data-filter="failed">❌ Failed (${data.itemResults.filter(r => !r.success).length})</button>
            </div>
            <div class="toolbar-right">
                <button class="toolbar-btn" id="exportJsonBtn" title="Export as JSON">
                    <span class="icon">📄</span> JSON
                </button>
                <button class="toolbar-btn" id="exportCsvBtn" title="Export as CSV">
                    <span class="icon">📊</span> CSV
                </button>
                <button class="toolbar-btn" id="copyBtn" title="Copy Results">
                    <span class="icon">📋</span> Copy
                </button>
            </div>
        </div>
    `;
}

/**
 * Generate header section with execution info
 */
function getHeader(data: PipelineResultViewData): string {
    const statusIcon = data.success ? '✅' : '❌';
    const statusText = data.success ? 'Completed' : 'Failed';
    const statusClass = data.success ? 'status-success' : 'status-error';

    const completedTime = formatRelativeTime(data.completedAt);

    return `
        <div class="header">
            <div class="header-title">
                <span class="header-icon">📊</span>
                <h2>${escapeHtml(data.pipelineName)}</h2>
                <span class="status-badge ${statusClass}">${statusIcon} ${statusText}</span>
            </div>
            <div class="header-meta">
                <span class="meta-item">
                    <span class="meta-label">Package:</span>
                    <span class="meta-value">${escapeHtml(data.packageName)}</span>
                </span>
                <span class="meta-divider">|</span>
                <span class="meta-item">
                    <span class="meta-label">Completed:</span>
                    <span class="meta-value">${completedTime}</span>
                </span>
                <span class="meta-divider">|</span>
                <span class="meta-item">
                    <span class="meta-label">Duration:</span>
                    <span class="meta-value">${formatDuration(data.totalTimeMs)}</span>
                </span>
            </div>
            ${data.error ? `<div class="header-error">⚠️ ${escapeHtml(data.error)}</div>` : ''}
        </div>
    `;
}

/**
 * Generate summary statistics section
 */
function getSummarySection(data: PipelineResultViewData): string {
    const stats = data.executionStats;
    const successRate = stats.totalItems > 0
        ? Math.round((stats.successfulMaps / stats.totalItems) * 100)
        : 0;

    return `
        <div class="summary-section">
            <h3 class="section-title">Execution Summary</h3>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${stats.totalItems}</div>
                    <div class="stat-label">Total Items</div>
                </div>
                <div class="stat-card success">
                    <div class="stat-value">${stats.successfulMaps}</div>
                    <div class="stat-label">Successful</div>
                </div>
                <div class="stat-card ${stats.failedMaps > 0 ? 'error' : ''}">
                    <div class="stat-value">${stats.failedMaps}</div>
                    <div class="stat-label">Failed</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${successRate}%</div>
                    <div class="stat-label">Success Rate</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${formatDuration(stats.mapPhaseTimeMs)}</div>
                    <div class="stat-label">Map Phase</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${stats.maxConcurrency}</div>
                    <div class="stat-label">Concurrency</div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Generate results grid with clickable nodes
 */
function getResultsGrid(data: PipelineResultViewData): string {
    return `
        <div class="results-section">
            <h3 class="section-title">Individual Results</h3>
            <p class="section-hint">Click on a result to see full details</p>
            <div class="results-grid" id="resultsGrid">
                ${data.itemResults.map((result, index) => getResultNode(result, index)).join('')}
            </div>
        </div>
    `;
}

/**
 * Generate a single result node card
 */
function getResultNode(result: PipelineItemResultNode, index: number): string {
    const statusIcon = getStatusIcon(result.success);
    const statusClass = getStatusClass(result.success);
    const preview = getItemPreview(result, 30);
    const timeInfo = result.executionTimeMs ? formatDuration(result.executionTimeMs) : '';

    return `
        <div class="result-node ${statusClass}" data-index="${index}" data-success="${result.success}">
            <div class="node-header">
                <span class="node-index">#${index + 1}</span>
                <span class="node-status">${statusIcon}</span>
            </div>
            <div class="node-preview">${escapeHtml(preview)}</div>
            ${timeInfo ? `<div class="node-time">${timeInfo}</div>` : ''}
            ${!result.success && result.error ? `<div class="node-error-hint">Error</div>` : ''}
        </div>
    `;
}

/**
 * Generate details panel (initially shows first item or summary)
 */
function getDetailsPanel(data: PipelineResultViewData): string {
    const firstResult = data.itemResults[0];
    const initialContent = firstResult
        ? getItemDetailContent(firstResult)
        : getSummaryDetailContent(data);

    return `
        <div class="details-panel" id="detailsPanel">
            <div class="details-content" id="detailsContent">
                ${initialContent}
            </div>
        </div>
        
        <!-- Hidden data for JavaScript -->
        <script type="application/json" id="resultData">
            ${JSON.stringify({
                pipelineName: data.pipelineName,
                packageName: data.packageName,
                success: data.success,
                totalTimeMs: data.totalTimeMs,
                executionStats: data.executionStats,
                itemResults: data.itemResults,
                formattedOutput: data.output?.formattedOutput || ''
            })}
        </script>
    `;
}

/**
 * Generate detail content for a single item
 */
export function getItemDetailContent(result: PipelineItemResultNode): string {
    const statusIcon = getStatusIcon(result.success);
    const statusClass = getStatusClass(result.success);

    const inputHtml = Object.entries(result.input)
        .map(([key, value]) => `
            <div class="detail-field">
                <span class="field-label">${escapeHtml(key)}:</span>
                <span class="field-value">${escapeHtml(String(value))}</span>
            </div>
        `).join('');

    const outputHtml = result.success
        ? Object.entries(result.output)
            .map(([key, value]) => `
                <div class="detail-field">
                    <span class="field-label">${escapeHtml(key)}:</span>
                    <span class="field-value">${escapeHtml(formatValue(value))}</span>
                </div>
            `).join('')
        : `<div class="error-message">${escapeHtml(result.error || 'Unknown error')}</div>`;

    return `
        <div class="detail-section">
            <h4 class="detail-title">
                <span class="status-icon ${statusClass}">${statusIcon}</span>
                Item #${result.index + 1}
            </h4>
            
            <div class="detail-subsection">
                <h5 class="subsection-title">📥 Input</h5>
                <div class="fields-list">
                    ${inputHtml}
                </div>
            </div>
            
            <div class="detail-subsection">
                <h5 class="subsection-title">${result.success ? '📤 Output' : '⚠️ Error'}</h5>
                <div class="fields-list ${result.success ? '' : 'error-content'}">
                    ${outputHtml}
                </div>
            </div>
            
            ${result.rawResponse ? `
                <div class="detail-subsection collapsible">
                    <h5 class="subsection-title toggle-header" onclick="toggleRawResponse(this)">
                        🔧 Raw AI Response <span class="toggle-icon">▶</span>
                    </h5>
                    <pre class="raw-response collapsed">${escapeHtml(result.rawResponse)}</pre>
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * Generate summary detail content
 */
function getSummaryDetailContent(data: PipelineResultViewData): string {
    return `
        <div class="detail-section">
            <h4 class="detail-title">📊 Results Summary</h4>
            
            ${data.output?.formattedOutput ? `
                <div class="formatted-output">
                    <pre>${escapeHtml(data.output.formattedOutput)}</pre>
                </div>
            ` : '<p class="no-output">No formatted output available</p>'}
        </div>
    `;
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
        return String(value);
    }
    if (Array.isArray(value)) {
        return JSON.stringify(value);
    }
    if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
    }
    return String(value);
}

/**
 * Get CSS styles for the result viewer
 */
function getStyles(isDark: boolean): string {
    return `
        :root {
            --bg-color: ${isDark ? '#1e1e1e' : '#ffffff'};
            --text-color: ${isDark ? '#cccccc' : '#333333'};
            --border-color: ${isDark ? '#404040' : '#e0e0e0'};
            --accent-color: ${isDark ? '#569cd6' : '#0066cc'};
            --success-color: #4caf50;
            --warning-color: #ff9800;
            --error-color: #f44336;
            --code-bg: ${isDark ? '#2d2d2d' : '#f5f5f5'};
            --hover-bg: ${isDark ? '#2a2d2e' : '#f0f0f0'};
            --card-bg: ${isDark ? '#252526' : '#ffffff'};
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--text-color);
            background: var(--bg-color);
            margin: 0;
            padding: 0;
            line-height: 1.5;
        }

        .container {
            padding: 16px;
            max-width: 100%;
        }

        /* Toolbar */
        .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-color);
            flex-wrap: wrap;
        }

        .toolbar-left, .toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-label {
            font-size: 12px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        .filter-btn {
            padding: 4px 10px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--bg-color);
            color: var(--text-color);
            cursor: pointer;
            font-size: 11px;
            transition: all 0.2s;
        }

        .filter-btn:hover {
            background: var(--hover-bg);
        }

        .filter-btn.active {
            background: var(--accent-color);
            color: white;
            border-color: var(--accent-color);
        }

        .toolbar-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--bg-color);
            color: var(--text-color);
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        }

        .toolbar-btn:hover {
            background: var(--hover-bg);
        }

        .toolbar-btn .icon {
            font-size: 14px;
        }

        /* Header */
        .header {
            margin-bottom: 20px;
        }

        .header-title {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0 0 8px 0;
        }

        .header-title h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
        }

        .header-icon {
            font-size: 20px;
        }

        .status-badge {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
        }

        .status-badge.status-success {
            background: rgba(76, 175, 80, 0.15);
            color: var(--success-color);
        }

        .status-badge.status-error {
            background: rgba(244, 67, 54, 0.15);
            color: var(--error-color);
        }

        .header-meta {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        .meta-item {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .meta-label {
            font-weight: 500;
        }

        .meta-divider {
            color: var(--border-color);
        }

        .header-error {
            margin-top: 12px;
            padding: 12px;
            background: ${isDark ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'};
            border: 1px solid var(--error-color);
            border-radius: 4px;
            color: var(--error-color);
        }

        /* Summary Section */
        .summary-section {
            margin-bottom: 20px;
        }

        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 12px 0;
            color: var(--text-color);
        }

        .section-hint {
            font-size: 11px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
            margin: -8px 0 12px 0;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 12px;
        }

        .stat-card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            text-align: center;
        }

        .stat-card.success {
            border-color: var(--success-color);
        }

        .stat-card.error {
            border-color: var(--error-color);
        }

        .stat-value {
            font-size: 24px;
            font-weight: 600;
            color: var(--text-color);
        }

        .stat-card.success .stat-value {
            color: var(--success-color);
        }

        .stat-card.error .stat-value {
            color: var(--error-color);
        }

        .stat-label {
            font-size: 11px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
            margin-top: 4px;
        }

        /* Results Grid */
        .results-section {
            margin-bottom: 20px;
        }

        .results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 12px;
        }

        .result-node {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .result-node:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }

        .result-node.selected {
            border-color: var(--accent-color);
            box-shadow: 0 0 0 2px rgba(86, 156, 214, 0.3);
        }

        .result-node.status-success {
            border-left: 3px solid var(--success-color);
        }

        .result-node.status-error {
            border-left: 3px solid var(--error-color);
        }

        .result-node.hidden {
            display: none;
        }

        .node-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .node-index {
            font-size: 11px;
            font-weight: 600;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        .node-status {
            font-size: 14px;
        }

        .node-preview {
            font-size: 12px;
            color: var(--text-color);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .node-time {
            font-size: 10px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
            margin-top: 4px;
        }

        .node-error-hint {
            font-size: 10px;
            color: var(--error-color);
            margin-top: 4px;
        }

        /* Details Panel */
        .details-panel {
            background: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
        }

        .detail-section {
            animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .detail-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 16px 0;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .status-icon {
            font-size: 16px;
        }

        .detail-subsection {
            margin-bottom: 16px;
        }

        .subsection-title {
            font-size: 12px;
            font-weight: 600;
            margin: 0 0 8px 0;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        .fields-list {
            background: ${isDark ? '#1e1e1e' : '#ffffff'};
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 12px;
        }

        .detail-field {
            margin-bottom: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }

        .detail-field:last-child {
            margin-bottom: 0;
        }

        .field-label {
            font-weight: 500;
            color: var(--accent-color);
        }

        .field-value {
            word-break: break-word;
        }

        .error-content {
            background: ${isDark ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'};
            border-color: var(--error-color);
        }

        .error-message {
            color: var(--error-color);
        }

        /* Collapsible raw response */
        .toggle-header {
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .toggle-icon {
            font-size: 10px;
            transition: transform 0.2s;
        }

        .toggle-header.open .toggle-icon {
            transform: rotate(90deg);
        }

        .raw-response {
            background: ${isDark ? '#1e1e1e' : '#ffffff'};
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 12px;
            margin: 0;
            overflow-x: auto;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 11px;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 200px;
            overflow-y: auto;
        }

        .raw-response.collapsed {
            display: none;
        }

        .formatted-output {
            background: ${isDark ? '#1e1e1e' : '#ffffff'};
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 12px;
            overflow-x: auto;
            max-height: 400px;
            overflow-y: auto;
        }

        .formatted-output pre {
            margin: 0;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            white-space: pre-wrap;
        }

        .no-output {
            color: ${isDark ? '#9d9d9d' : '#666666'};
            font-style: italic;
        }

        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        .empty-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        .empty-state h3 {
            margin: 0 0 8px 0;
            color: var(--text-color);
        }

        .empty-state p {
            margin: 0;
        }
    `;
}

/**
 * Get JavaScript for the result viewer webview
 */
function getScript(data: PipelineResultViewData | undefined): string {
    return `
        const vscode = acquireVsCodeApi();
        
        // Parse result data
        const dataElement = document.getElementById('resultData');
        const resultData = dataElement ? JSON.parse(dataElement.textContent) : null;
        
        let selectedNodeIndex = 0;
        let currentFilter = 'all';

        // Node click handler
        function selectNode(index) {
            if (!resultData || index < 0 || index >= resultData.itemResults.length) return;
            
            // Update selection state
            document.querySelectorAll('.result-node').forEach((node, i) => {
                node.classList.toggle('selected', i === index);
            });
            
            selectedNodeIndex = index;
            
            // Update details panel
            const result = resultData.itemResults[index];
            const detailsContent = document.getElementById('detailsContent');
            if (detailsContent) {
                detailsContent.innerHTML = generateItemDetail(result);
            }
            
            // Notify extension
            vscode.postMessage({
                type: 'nodeClick',
                payload: { nodeIndex: index, nodeId: result.id }
            });
        }

        // Generate item detail HTML
        function generateItemDetail(result) {
            const statusIcon = result.success ? '✅' : '❌';
            const statusClass = result.success ? 'status-success' : 'status-error';
            
            let inputHtml = '';
            for (const [key, value] of Object.entries(result.input)) {
                inputHtml += '<div class="detail-field">' +
                    '<span class="field-label">' + escapeHtml(key) + ':</span>' +
                    '<span class="field-value">' + escapeHtml(String(value)) + '</span>' +
                    '</div>';
            }
            
            let outputHtml = '';
            if (result.success) {
                for (const [key, value] of Object.entries(result.output)) {
                    outputHtml += '<div class="detail-field">' +
                        '<span class="field-label">' + escapeHtml(key) + ':</span>' +
                        '<span class="field-value">' + escapeHtml(formatValue(value)) + '</span>' +
                        '</div>';
                }
            } else {
                outputHtml = '<div class="error-message">' + escapeHtml(result.error || 'Unknown error') + '</div>';
            }
            
            let html = '<div class="detail-section">' +
                '<h4 class="detail-title">' +
                '<span class="status-icon ' + statusClass + '">' + statusIcon + '</span>' +
                'Item #' + (result.index + 1) +
                '</h4>' +
                '<div class="detail-subsection">' +
                '<h5 class="subsection-title">📥 Input</h5>' +
                '<div class="fields-list">' + inputHtml + '</div>' +
                '</div>' +
                '<div class="detail-subsection">' +
                '<h5 class="subsection-title">' + (result.success ? '📤 Output' : '⚠️ Error') + '</h5>' +
                '<div class="fields-list ' + (result.success ? '' : 'error-content') + '">' + outputHtml + '</div>' +
                '</div>';
            
            if (result.rawResponse) {
                html += '<div class="detail-subsection collapsible">' +
                    '<h5 class="subsection-title toggle-header" onclick="toggleRawResponse(this)">' +
                    '🔧 Raw AI Response <span class="toggle-icon">▶</span>' +
                    '</h5>' +
                    '<pre class="raw-response collapsed">' + escapeHtml(result.rawResponse) + '</pre>' +
                    '</div>';
            }
            
            html += '</div>';
            return html;
        }

        // Toggle raw response visibility
        window.toggleRawResponse = function(header) {
            header.classList.toggle('open');
            const rawResponse = header.nextElementSibling;
            if (rawResponse) {
                rawResponse.classList.toggle('collapsed');
            }
        };

        // Filter results
        function applyFilter(filter) {
            currentFilter = filter;
            
            // Update filter buttons
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.filter === filter);
            });
            
            // Show/hide nodes
            document.querySelectorAll('.result-node').forEach(node => {
                const success = node.dataset.success === 'true';
                let show = true;
                
                if (filter === 'success') show = success;
                else if (filter === 'failed') show = !success;
                
                node.classList.toggle('hidden', !show);
            });
            
            vscode.postMessage({
                type: 'filterResults',
                payload: { filterType: filter }
            });
        }

        // Export handlers
        function exportResults(format) {
            vscode.postMessage({
                type: 'exportResults',
                payload: { exportFormat: format }
            });
        }

        // Copy results
        function copyResults() {
            vscode.postMessage({ type: 'copyResults' });
        }

        // Escape HTML
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Format value for display
        function formatValue(value) {
            if (value === null || value === undefined) return 'null';
            if (typeof value === 'string') return value;
            if (typeof value === 'boolean') return value ? 'true' : 'false';
            if (typeof value === 'number') return String(value);
            if (Array.isArray(value)) return JSON.stringify(value);
            if (typeof value === 'object') return JSON.stringify(value, null, 2);
            return String(value);
        }

        // Event listeners
        document.querySelectorAll('.result-node').forEach((node, index) => {
            node.addEventListener('click', () => selectNode(index));
        });

        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
        });

        document.getElementById('exportJsonBtn')?.addEventListener('click', () => exportResults('json'));
        document.getElementById('exportCsvBtn')?.addEventListener('click', () => exportResults('csv'));
        document.getElementById('copyBtn')?.addEventListener('click', copyResults);

        // Select first node initially
        if (resultData && resultData.itemResults.length > 0) {
            selectNode(0);
        }

        // Notify extension that webview is ready
        vscode.postMessage({ type: 'ready' });
    `;
}

/**
 * Generate a nonce for script security
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Format relative time
 */
function formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
        return 'just now';
    }
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }

    return date.toLocaleDateString();
}
