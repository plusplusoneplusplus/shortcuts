/**
 * Webview Content for Discovery Preview
 * 
 * Generates HTML/CSS/JS for the discovery results webview panel.
 */

import * as vscode from 'vscode';
import { DiscoveryResult, DiscoveryProcess, DiscoverySourceType } from '../types';
import { getRelevanceLevel } from '../relevance-scorer';

/**
 * Message types for webview communication
 */
export type WebviewMessageType =
    | 'toggleItem'
    | 'selectAll'
    | 'deselectAll'
    | 'addToGroup'
    | 'filterByScore'
    | 'filterByExtension'
    | 'refresh'
    | 'cancel'
    | 'showWarning';

/**
 * Extension filter state per result type
 * Key is the DiscoverySourceType, value is the selected extension (empty string means "All")
 */
export type ExtensionFilters = Record<string, string>;

/**
 * Message from webview to extension
 */
export interface WebviewMessage {
    type: WebviewMessageType;
    payload?: any;
}

/**
 * Generate the webview HTML content
 */
export function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    process: DiscoveryProcess | undefined,
    groups: string[],
    minScore: number,
    selectedTargetGroup: string = '',
    extensionFilters: ExtensionFilters = {}
): string {
    const nonce = getNonce();
    
    // Get the local path to main script/style
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'styles', 'discovery.css')
    );
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Discovery Results</title>
    <style>
        ${getStyles()}
    </style>
</head>
<body>
    <div class="container">
        ${getHeaderContent(process)}
        ${getFilterContent(minScore, groups, selectedTargetGroup)}
        ${getResultsContent(process, minScore, extensionFilters)}
        ${getActionsContent(process, groups)}
    </div>
    <script nonce="${nonce}">
        ${getScript()}
    </script>
</body>
</html>`;
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
 * Get CSS styles
 */
function getStyles(): string {
    return `
        :root {
            --vscode-font-family: var(--vscode-editor-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
        }
        
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        .container {
            padding: 16px;
            max-width: 100%;
        }
        
        /* Header */
        .header {
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .header h2 {
            margin: 0 0 8px 0;
            font-size: 16px;
            font-weight: 600;
        }
        
        .header .description {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        .header .status {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
        }
        
        .status-badge {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .status-running {
            background-color: var(--vscode-progressBar-background);
            color: var(--vscode-editor-background);
        }
        
        .status-completed {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
        }
        
        .status-failed {
            background-color: var(--vscode-testing-iconFailed);
            color: var(--vscode-editor-background);
        }
        
        .progress-bar {
            flex: 1;
            height: 4px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 2px;
            overflow: hidden;
        }
        
        .progress-bar-fill {
            height: 100%;
            background-color: var(--vscode-button-background);
            transition: width 0.3s ease;
        }
        
        /* Filters */
        .filters {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin-bottom: 16px;
            padding: 12px;
            background-color: var(--vscode-sideBar-background);
            border-radius: 6px;
        }
        
        .filter-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .filter-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .filter-input {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
        }
        
        .filter-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        /* Results */
        .results {
            margin-bottom: 16px;
        }
        
        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .results-count {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .select-buttons {
            display: flex;
            gap: 8px;
        }
        
        .select-btn {
            padding: 2px 8px;
            font-size: 11px;
            background: none;
            border: 1px solid var(--vscode-button-border, var(--vscode-button-background));
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
        }
        
        .select-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .result-group {
            margin-bottom: 16px;
        }
        
        .result-group-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 0;
            font-weight: 600;
            color: var(--vscode-sideBarSectionHeader-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .result-group-icon {
            font-size: 14px;
        }
        
        .result-group-label {
            flex: 1;
        }
        
        .extension-filter {
            padding: 2px 6px;
            font-size: 11px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            cursor: pointer;
            min-width: 60px;
        }
        
        .extension-filter:hover {
            border-color: var(--vscode-focusBorder);
        }
        
        .extension-filter:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        .result-item-empty {
            padding: 12px 8px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            text-align: center;
        }
        
        .result-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .result-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 8px;
            border-bottom: 1px solid var(--vscode-list-inactiveSelectionBackground);
            cursor: pointer;
        }
        
        .result-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .result-item.selected {
            background-color: var(--vscode-list-activeSelectionBackground);
        }
        
        .result-checkbox {
            margin-top: 2px;
        }
        
        .result-content {
            flex: 1;
            min-width: 0;
        }
        
        .result-name {
            font-weight: 500;
            word-break: break-word;
        }
        
        .result-path {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            word-break: break-all;
        }
        
        .result-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 4px;
        }
        
        .result-score {
            padding: 1px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: 500;
        }
        
        .score-high {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
        }
        
        .score-medium {
            background-color: var(--vscode-editorWarning-foreground);
            color: var(--vscode-editor-background);
        }
        
        .score-low {
            background-color: var(--vscode-descriptionForeground);
            color: var(--vscode-editor-background);
        }
        
        .result-keywords {
            font-size: 10px;
            color: var(--vscode-textLink-foreground);
        }
        
        .result-reason {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        
        /* Actions */
        .actions {
            display: flex;
            gap: 12px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        .action-btn {
            padding: 8px 16px;
            font-size: 13px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
        }
        
        .action-btn.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .action-btn.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .action-btn.primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .action-btn.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .action-btn.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 32px;
            color: var(--vscode-descriptionForeground);
        }
        
        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        
        /* Error state */
        .error-state {
            padding: 16px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            color: var(--vscode-inputValidation-errorForeground);
        }
    `;
}

/**
 * Get header content
 */
function getHeaderContent(process: DiscoveryProcess | undefined): string {
    if (!process) {
        return `
            <div class="header">
                <h2>🔍 Auto Discovery</h2>
                <p class="description">Start a discovery to find related files and commits.</p>
            </div>
        `;
    }
    
    const statusClass = `status-${process.status}`;
    const statusLabel = process.status.charAt(0).toUpperCase() + process.status.slice(1);
    
    return `
        <div class="header">
            <h2>🔍 Discovery Results</h2>
            <p class="description">${escapeHtml(process.featureDescription)}</p>
            <div class="status">
                <span class="status-badge ${statusClass}">${statusLabel}</span>
                ${process.status === 'running' ? `
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: ${process.progress}%"></div>
                    </div>
                    <span>${process.progress}%</span>
                ` : ''}
            </div>
            ${process.error ? `<div class="error-state">${escapeHtml(process.error)}</div>` : ''}
        </div>
    `;
}

/**
 * Get filter content
 */
function getFilterContent(minScore: number, groups: string[], selectedTargetGroup: string = ''): string {
    const groupOptions = groups.map(g => {
        const isSelected = g === selectedTargetGroup ? ' selected' : '';
        return `<option value="${escapeHtml(g)}"${isSelected}>${escapeHtml(g)}</option>`;
    }).join('');
    
    // Note: Using event listener in script instead of inline oninput
    return `
        <div class="filters">
            <div class="filter-group">
                <label class="filter-label">Min Score</label>
                <input type="range" class="filter-input" id="minScoreFilter" 
                    min="0" max="100" value="${minScore}">
                <span id="minScoreValue">${minScore}</span>
            </div>
            <div class="filter-group">
                <label class="filter-label">Target Group</label>
                <select class="filter-input" id="targetGroup">
                    <option value="">Select a group...</option>
                    ${groupOptions}
                </select>
            </div>
        </div>
    `;
}

/**
 * Get results content
 */
function getResultsContent(process: DiscoveryProcess | undefined, minScore: number, extensionFilters: ExtensionFilters = {}): string {
    if (!process) {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <p>No discovery in progress</p>
            </div>
        `;
    }
    
    if (process.status === 'running') {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">⏳</div>
                <p>Searching for related items...</p>
                <p>${process.phase}</p>
            </div>
        `;
    }
    
    if (!process.results || process.results.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>No results found</p>
            </div>
        `;
    }
    
    // Filter by min score first
    const scoreFilteredResults = process.results.filter(r => r.relevanceScore >= minScore);
    
    // Group results by type (before extension filtering to collect all extensions)
    const groupedByType = groupResultsByType(scoreFilteredResults);
    
    // Collect unique extensions per type and apply extension filters
    const extensionsByType = collectExtensionsByType(scoreFilteredResults);
    
    // Apply extension filters to get final filtered results
    const filteredResults = applyExtensionFilters(scoreFilteredResults, extensionFilters);
    const grouped = groupResultsByType(filteredResults);
    
    const selectedCount = filteredResults.filter(r => r.selected).length;
    
    // Note: Using CSS classes for event delegation instead of inline onclick
    let html = `
        <div class="results">
            <div class="results-header">
                <span class="results-count">${filteredResults.length} results (${selectedCount} selected)</span>
                <div class="select-buttons">
                    <button class="select-btn select-all-btn">Select All</button>
                    <button class="select-btn deselect-all-btn">Deselect All</button>
                </div>
            </div>
    `;
    
    // Render each group with extension filter (use groupedByType to show all types even if filtered empty)
    for (const [type, allResults] of groupedByType) {
        const filteredTypeResults = grouped.get(type) || [];
        const extensions = extensionsByType.get(type) || [];
        const selectedExtension = extensionFilters[type] || '';
        html += renderResultGroup(type, filteredTypeResults, extensions, selectedExtension, allResults.length);
    }
    
    html += '</div>';
    return html;
}

/**
 * Render a result group
 */
function renderResultGroup(
    type: DiscoverySourceType,
    results: DiscoveryResult[],
    extensions: string[] = [],
    selectedExtension: string = '',
    totalCount?: number
): string {
    const icon = getTypeIcon(type);
    const label = getTypeLabel(type);
    
    // Show total count if filtered, otherwise just show results.length
    const countDisplay = totalCount !== undefined && totalCount !== results.length
        ? `${results.length}/${totalCount}`
        : `${results.length}`;
    
    // Generate extension filter dropdown for file and doc types
    let extensionFilter = '';
    if ((type === 'file' || type === 'doc') && extensions.length > 0) {
        const options = extensions.map(ext => {
            const isSelected = ext === selectedExtension ? ' selected' : '';
            return `<option value="${escapeHtml(ext)}"${isSelected}>${escapeHtml(ext)}</option>`;
        }).join('');
        
        extensionFilter = `
            <select class="extension-filter" data-type="${escapeHtml(type)}">
                <option value=""${selectedExtension === '' ? ' selected' : ''}>All</option>
                ${options}
            </select>
        `;
    }
    
    let html = `
        <div class="result-group" data-group-type="${escapeHtml(type)}">
            <div class="result-group-header">
                <span class="result-group-icon">${icon}</span>
                <span class="result-group-label">${label} (${countDisplay})</span>
                ${extensionFilter}
            </div>
            <ul class="result-list">
    `;
    
    if (results.length === 0) {
        html += `<li class="result-item-empty">No items match the current filter</li>`;
    } else {
        for (const result of results) {
            html += renderResultItem(result);
        }
    }
    
    html += '</ul></div>';
    return html;
}

/**
 * Render a single result item
 */
function renderResultItem(result: DiscoveryResult): string {
    const level = getRelevanceLevel(result.relevanceScore);
    const scoreClass = `score-${level}`;
    const selectedClass = result.selected ? 'selected' : '';
    
    const path = result.path || (result.commit ? result.commit.shortHash : '');
    const keywords = result.matchedKeywords.slice(0, 3).join(', ');
    
    // Note: Using data-id attribute for event delegation instead of inline onclick
    // This is required because CSP blocks inline event handlers
    return `
        <li class="result-item ${selectedClass}" data-id="${escapeHtml(result.id)}">
            <input type="checkbox" class="result-checkbox" ${result.selected ? 'checked' : ''} tabindex="-1">
            <div class="result-content">
                <div class="result-name">${escapeHtml(result.name)}</div>
                <div class="result-path">${escapeHtml(path)}</div>
                <div class="result-meta">
                    <span class="result-score ${scoreClass}">${result.relevanceScore}%</span>
                    ${keywords ? `<span class="result-keywords">${escapeHtml(keywords)}</span>` : ''}
                </div>
                <div class="result-reason">${escapeHtml(result.relevanceReason)}</div>
            </div>
        </li>
    `;
}

/**
 * Get actions content
 */
function getActionsContent(process: DiscoveryProcess | undefined, groups: string[]): string {
    if (!process || process.status !== 'completed' || !process.results?.length) {
        return '';
    }
    
    const selectedCount = process.results.filter(r => r.selected).length;
    
    // Note: Using CSS classes for event delegation instead of inline onclick
    return `
        <div class="actions">
            <button class="action-btn primary add-to-group-btn" ${selectedCount === 0 ? 'disabled' : ''}>
                Add ${selectedCount} Selected to Group
            </button>
            <button class="action-btn secondary refresh-btn">
                Refresh
            </button>
        </div>
`;
}

/**
 * Get script content
 * 
 * Uses event delegation to handle clicks instead of inline onclick handlers.
 * This is required because CSP blocks inline event handlers.
 */
function getScript(): string {
    return `
        (function() {
            const vscode = acquireVsCodeApi();
            
            // Event delegation for result item clicks
            document.addEventListener('click', function(e) {
                const target = e.target;
                
                // Handle result item clicks (toggle selection)
                const resultItem = target.closest('.result-item');
                if (resultItem) {
                    const id = resultItem.getAttribute('data-id');
                    if (id) {
                        vscode.postMessage({ type: 'toggleItem', payload: { id: id } });
                    }
                    return;
                }
                
                // Handle select all button
                if (target.closest('.select-all-btn')) {
                    vscode.postMessage({ type: 'selectAll' });
                    return;
                }
                
                // Handle deselect all button
                if (target.closest('.deselect-all-btn')) {
                    vscode.postMessage({ type: 'deselectAll' });
                    return;
                }
                
                // Handle add to group button
                if (target.closest('.add-to-group-btn')) {
                    const targetGroup = document.getElementById('targetGroup').value;
                    if (!targetGroup) {
                        // Use vscode notification instead of alert (which may be blocked)
                        vscode.postMessage({ type: 'showWarning', payload: { message: 'Please select a target group' } });
                        return;
                    }
                    vscode.postMessage({ type: 'addToGroup', payload: { targetGroup: targetGroup } });
                    return;
                }
                
                // Handle refresh button
                if (target.closest('.refresh-btn')) {
                    vscode.postMessage({ type: 'refresh' });
                    return;
                }
                
                // Handle cancel button
                if (target.closest('.cancel-btn')) {
                    vscode.postMessage({ type: 'cancel' });
                    return;
                }
            });
            
            // Handle min score slider changes
            document.addEventListener('input', function(e) {
                const target = e.target;
                if (target.id === 'minScoreFilter') {
                    const value = target.value;
                    const valueDisplay = document.getElementById('minScoreValue');
                    if (valueDisplay) {
                        valueDisplay.textContent = value;
                    }
                    vscode.postMessage({ type: 'filterByScore', payload: { minScore: parseInt(value, 10) } });
                }
            });
            
            // Handle extension filter changes
            document.addEventListener('change', function(e) {
                const target = e.target;
                if (target.classList.contains('extension-filter')) {
                    const type = target.getAttribute('data-type');
                    const extension = target.value;
                    if (type) {
                        vscode.postMessage({ 
                            type: 'filterByExtension', 
                            payload: { sourceType: type, extension: extension } 
                        });
                    }
                }
            });
        })();
    `;
}

/**
 * Group results by type
 */
function groupResultsByType(results: DiscoveryResult[]): Map<DiscoverySourceType, DiscoveryResult[]> {
    const grouped = new Map<DiscoverySourceType, DiscoveryResult[]>();
    
    for (const result of results) {
        const group = grouped.get(result.type) || [];
        group.push(result);
        grouped.set(result.type, group);
    }
    
    return grouped;
}

/**
 * Extract file extension from a path (cross-platform)
 * Handles both Windows (backslash) and Unix (forward slash) paths
 */
export function getFileExtension(filePath: string): string {
    if (!filePath) {
        return '';
    }
    
    // Normalize path separators for cross-platform support
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Get the filename (last segment after the last slash)
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    const filename = lastSlashIndex >= 0 ? normalizedPath.slice(lastSlashIndex + 1) : normalizedPath;
    
    // Handle dotfiles (e.g., .gitignore) - return the whole name as extension
    if (filename.startsWith('.') && filename.indexOf('.', 1) === -1) {
        return filename;
    }
    
    // Find the last dot for extension
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex <= 0) {
        return ''; // No extension or starts with dot only
    }
    
    return filename.slice(lastDotIndex).toLowerCase();
}

/**
 * Collect unique file extensions per result type
 * Only applicable for 'file' and 'doc' types which have paths
 */
export function collectExtensionsByType(results: DiscoveryResult[]): Map<DiscoverySourceType, string[]> {
    const extensionsByType = new Map<DiscoverySourceType, Set<string>>();
    
    for (const result of results) {
        // Only collect extensions for file and doc types
        if ((result.type === 'file' || result.type === 'doc') && result.path) {
            const ext = getFileExtension(result.path);
            if (ext) {
                const extSet = extensionsByType.get(result.type) || new Set<string>();
                extSet.add(ext);
                extensionsByType.set(result.type, extSet);
            }
        }
    }
    
    // Convert sets to sorted arrays
    const result = new Map<DiscoverySourceType, string[]>();
    for (const [type, extSet] of extensionsByType) {
        result.set(type, Array.from(extSet).sort());
    }
    
    return result;
}

/**
 * Apply extension filters to results
 */
export function applyExtensionFilters(results: DiscoveryResult[], extensionFilters: ExtensionFilters): DiscoveryResult[] {
    return results.filter(result => {
        const filter = extensionFilters[result.type];
        
        // No filter or "All" selected - include the result
        if (!filter) {
            return true;
        }
        
        // Only apply extension filter to file and doc types
        if ((result.type === 'file' || result.type === 'doc') && result.path) {
            const ext = getFileExtension(result.path);
            return ext === filter;
        }
        
        // Other types (commit, folder) are not filtered by extension
        return true;
    });
}

/**
 * Get icon for result type
 */
function getTypeIcon(type: DiscoverySourceType): string {
    switch (type) {
        case 'file': return '📄';
        case 'folder': return '📁';
        case 'doc': return '📝';
        case 'commit': return '🔀';
        default: return '📦';
    }
}

/**
 * Get label for result type
 */
function getTypeLabel(type: DiscoverySourceType): string {
    switch (type) {
        case 'file': return 'Files';
        case 'folder': return 'Folders';
        case 'doc': return 'Documentation';
        case 'commit': return 'Commits';
        default: return 'Other';
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

