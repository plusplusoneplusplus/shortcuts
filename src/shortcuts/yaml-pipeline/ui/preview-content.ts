/**
 * Pipeline Preview Content Generator
 *
 * Generates HTML content for the Pipeline Preview webview panel.
 * Uses Mermaid.js for diagram rendering with interactive node clicks.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import { PipelineConfig, CSVParseResult, PromptItem } from '../types';
import { PipelineInfo, ResourceFileInfo, ValidationResult } from './types';
import {
    generatePipelineMermaid,
    extractTemplateVariables,
    validateTemplateVariables,
    estimateExecutionTime,
    formatFileSize,
    PipelineNodeType
} from './preview-mermaid';

/**
 * Message types for webview communication
 */
export type PreviewMessageType =
    | 'nodeClick'
    | 'execute'
    | 'validate'
    | 'edit'
    | 'refresh'
    | 'openFile'
    | 'ready';

/**
 * Message from webview to extension
 */
export interface PreviewMessage {
    type: PreviewMessageType;
    payload?: {
        nodeId?: string;
        nodeType?: PipelineNodeType;
        filePath?: string;
    };
}

/**
 * Data to send to the webview for rendering
 */
export interface PipelinePreviewData {
    /** Pipeline configuration from YAML */
    config: PipelineConfig;
    /** Pipeline metadata */
    info: PipelineInfo;
    /** Validation result */
    validation: ValidationResult;
    /** CSV parse result for preview */
    csvInfo?: CSVParseResult;
    /** Preview of first few CSV rows */
    csvPreview?: PromptItem[];
}

/**
 * Generate HTML content for the Pipeline Preview webview
 */
export function getPreviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    data?: PipelinePreviewData
): string {
    const nonce = getNonce();
    const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; img-src ${webview.cspSource} data: https:;">
    <title>Pipeline Preview</title>
    <style>
        ${getStyles(isDark)}
    </style>
</head>
<body class="${isDark ? 'vscode-dark' : 'vscode-light'}">
    <div class="container">
        ${data ? getContentWithData(data, isDark) : getEmptyContent()}
    </div>
    <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
    <script nonce="${nonce}">
        ${getScript(data, isDark)}
    </script>
</body>
</html>`;
}

/**
 * Generate content when pipeline data is available
 */
function getContentWithData(data: PipelinePreviewData, isDark: boolean): string {
    const { config, info, validation, csvInfo, csvPreview } = data;

    // Generate mermaid diagram
    const mermaidDiagram = generatePipelineMermaid(
        config,
        csvInfo,
        info.resourceFiles,
        { theme: isDark ? 'dark' : 'default', showCounts: true }
    );

    return `
        ${getToolbar(info, validation)}
        ${getHeader(info, validation)}
        ${getDiagramSection(mermaidDiagram)}
        ${getDetailsPanel(config, csvInfo, csvPreview, info)}
    `;
}

/**
 * Generate content when no pipeline is selected
 */
function getEmptyContent(): string {
    return `
        <div class="empty-state">
            <div class="empty-icon">📋</div>
            <h3>No Pipeline Selected</h3>
            <p>Select a pipeline from the Pipelines view to preview its configuration.</p>
        </div>
    `;
}

/**
 * Generate toolbar section
 */
function getToolbar(info: PipelineInfo, validation: ValidationResult): string {
    return `
        <div class="toolbar">
            <button class="toolbar-btn" id="editBtn" title="Edit Pipeline">
                <span class="icon">✏️</span> Edit
            </button>
            <button class="toolbar-btn" id="executeBtn" title="Execute Pipeline" ${!validation.valid ? 'disabled' : ''}>
                <span class="icon">▶️</span> Execute
            </button>
            <button class="toolbar-btn" id="validateBtn" title="Validate Pipeline">
                <span class="icon">✅</span> Validate
            </button>
            <button class="toolbar-btn" id="refreshBtn" title="Refresh Preview">
                <span class="icon">🔄</span> Refresh
            </button>
        </div>
    `;
}

/**
 * Generate header section with pipeline info
 */
function getHeader(info: PipelineInfo, validation: ValidationResult): string {
    const statusIcon = validation.valid ? '✅' : '⚠️';
    const statusText = validation.valid ? 'Valid' : 'Has Errors';
    const statusClass = validation.valid ? 'status-valid' : 'status-error';

    const modifiedTime = formatRelativeTime(info.lastModified);

    return `
        <div class="header">
            <div class="header-title">
                <span class="header-icon">📦</span>
                <h2>${escapeHtml(info.name)}</h2>
            </div>
            ${info.description ? `<p class="header-description">${escapeHtml(info.description)}</p>` : ''}
            <div class="header-meta">
                <span class="meta-item">
                    <span class="meta-label">Package:</span>
                    <span class="meta-value">${escapeHtml(info.packageName)}</span>
                </span>
                <span class="meta-divider">|</span>
                <span class="meta-item">
                    <span class="meta-label">Modified:</span>
                    <span class="meta-value">${modifiedTime}</span>
                </span>
                <span class="meta-divider">|</span>
                <span class="meta-item ${statusClass}">
                    <span class="status-icon">${statusIcon}</span>
                    <span class="meta-value">${statusText}</span>
                </span>
            </div>
            ${getValidationErrors(validation)}
        </div>
    `;
}

/**
 * Generate validation errors section
 */
function getValidationErrors(validation: ValidationResult): string {
    if (validation.valid && validation.warnings.length === 0) {
        return '';
    }

    let html = '';

    if (!validation.valid && validation.errors.length > 0) {
        html += `
            <div class="validation-errors">
                <div class="validation-title">⚠️ Validation Errors</div>
                <ul class="validation-list">
                    ${validation.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    if (validation.warnings.length > 0) {
        html += `
            <div class="validation-warnings">
                <div class="validation-title">💡 Warnings</div>
                <ul class="validation-list">
                    ${validation.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    return html;
}

/**
 * Generate diagram section with mermaid
 */
function getDiagramSection(mermaidDiagram: string): string {
    return `
        <div class="diagram-section">
            <h3 class="section-title">Pipeline Flow</h3>
            <div class="diagram-container">
                <div class="mermaid" id="pipelineDiagram">
${mermaidDiagram}
                </div>
            </div>
            <p class="diagram-hint">Click on a node to see details</p>
        </div>
    `;
}

/**
 * Generate details panel that updates on node click
 */
function getDetailsPanel(
    config: PipelineConfig,
    csvInfo?: CSVParseResult,
    csvPreview?: PromptItem[],
    info?: PipelineInfo
): string {
    return `
        <div class="details-panel" id="detailsPanel">
            <div class="details-content" id="detailsContent">
                ${getInputDetails(config, csvInfo, csvPreview, true)}
            </div>
        </div>
        
        <!-- Hidden data for JavaScript -->
        <script type="application/json" id="pipelineData">
            ${JSON.stringify({
                config,
                csvInfo: csvInfo ? {
                    headers: csvInfo.headers,
                    rowCount: csvInfo.rowCount
                } : null,
                csvPreview,
                resources: info?.resourceFiles || []
            })}
        </script>
    `;
}

/**
 * Generate INPUT node details
 */
export function getInputDetails(
    config: PipelineConfig,
    csvInfo?: CSVParseResult,
    csvPreview?: PromptItem[],
    initial: boolean = false
): string {
    const headers = csvInfo?.headers || [];
    const rowCount = csvInfo?.rowCount || 0;
    
    // Determine input type and path based on new config structure
    const hasInlineItems = config.input.items && config.input.items.length > 0;
    const hasCSVSource = config.input.from?.type === 'csv';
    const inputType = hasInlineItems ? 'INLINE' : (hasCSVSource ? 'CSV' : 'UNKNOWN');
    const csvPath = config.input.from?.path || '';
    const delimiter = config.input.from?.delimiter;
    const itemCount = hasInlineItems ? config.input.items!.length : rowCount;
    const limit = config.input.limit;

    return `
        <div class="detail-section ${initial ? 'active' : ''}">
            <h4 class="detail-title">📥 INPUT Configuration</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Type:</span>
                    <span class="detail-value">${inputType}</span>
                </div>
                ${hasCSVSource ? `
                <div class="detail-item">
                    <span class="detail-label">File:</span>
                    <span class="detail-value file-link" data-path="${escapeHtml(csvPath)}">${escapeHtml(csvPath)}</span>
                </div>
                ` : ''}
                ${hasInlineItems ? `
                <div class="detail-item">
                    <span class="detail-label">Inline Items:</span>
                    <span class="detail-value">${itemCount} items</span>
                </div>
                ` : ''}
                ${csvInfo ? `
                <div class="detail-item">
                    <span class="detail-label">Rows:</span>
                    <span class="detail-value">${rowCount}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Columns:</span>
                    <span class="detail-value">${headers.join(', ')}</span>
                </div>
                ` : ''}
                ${delimiter && delimiter !== ',' ? `
                <div class="detail-item">
                    <span class="detail-label">Delimiter:</span>
                    <span class="detail-value">${escapeHtml(delimiter)}</span>
                </div>
                ` : ''}
                ${limit ? `
                <div class="detail-item">
                    <span class="detail-label">Limit:</span>
                    <span class="detail-value">${limit} items</span>
                </div>
                ` : ''}
            </div>
            ${csvPreview && csvPreview.length > 0 ? getCSVPreviewTable(headers, csvPreview) : ''}
        </div>
    `;
}

/**
 * Generate CSV preview table
 */
function getCSVPreviewTable(headers: string[], preview: PromptItem[]): string {
    return `
        <div class="csv-preview">
            <h5 class="preview-title">📊 Preview (first ${preview.length} rows)</h5>
            <div class="table-container">
                <table class="preview-table">
                    <thead>
                        <tr>
                            ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${preview.map(row => `
                            <tr>
                                ${headers.map(h => `<td>${escapeHtml(String(row[h] || ''))}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Generate MAP node details
 */
export function getMapDetails(config: PipelineConfig, csvHeaders?: string[]): string {
    const parallel = config.map.parallel || 5;
    const variables = extractTemplateVariables(config.map.prompt);
    const validation = csvHeaders
        ? validateTemplateVariables(config.map.prompt, csvHeaders)
        : { valid: true, missingVariables: [] as string[] };

    return `
        <div class="detail-section active">
            <h4 class="detail-title">🔄 MAP Configuration</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Parallelism:</span>
                    <span class="detail-value">${parallel} concurrent AI calls</span>
                </div>
                ${config.map.model ? `
                <div class="detail-item">
                    <span class="detail-label">Model:</span>
                    <span class="detail-value">${escapeHtml(config.map.model)}</span>
                </div>
                ` : ''}
                <div class="detail-item">
                    <span class="detail-label">Output Fields:</span>
                    <span class="detail-value output-fields">${config.map.output.map(o => `<span class="field-tag">${escapeHtml(o)}</span>`).join('')}</span>
                </div>
            </div>
            
            <div class="prompt-section">
                <h5 class="prompt-title">📝 Prompt Template</h5>
                <pre class="prompt-template">${escapeHtml(config.map.prompt)}</pre>
            </div>
            
            <div class="variables-section">
                <h5 class="variables-title">🔗 Template Variables</h5>
                <ul class="variables-list">
                    ${variables.map(v => {
                        const isMissing = !validation.valid && validation.missingVariables.includes(v);
                        return `<li class="${isMissing ? 'variable-missing' : 'variable-found'}">
                            <code>{{${escapeHtml(v)}}}</code>
                            ${isMissing ? '<span class="variable-warning">⚠️ Not found in CSV</span>' : '<span class="variable-source">← from input column</span>'}
                        </li>`;
                    }).join('')}
                </ul>
            </div>
        </div>
    `;
}

/**
 * Generate REDUCE node details
 */
export function getReduceDetails(config: PipelineConfig, rowCount?: number): string {
    const reduceDescriptions: Record<string, string> = {
        'json': 'Outputs all results as a JSON array',
        'list': 'Outputs results as a formatted list',
        'csv': 'Outputs results as CSV format',
        'markdown': 'Outputs results as Markdown document',
        'summary': 'Generates a summary of all results'
    };

    const description = reduceDescriptions[config.reduce.type] || 'Custom output format';

    return `
        <div class="detail-section active">
            <h4 class="detail-title">📤 REDUCE Configuration</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Type:</span>
                    <span class="detail-value">${config.reduce.type}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Format:</span>
                    <span class="detail-value">${description}</span>
                </div>
                ${rowCount ? `
                <div class="detail-item">
                    <span class="detail-label">Expected Output:</span>
                    <span class="detail-value">${rowCount} items (one per input row)</span>
                </div>
                ` : ''}
            </div>
            
            <div class="output-schema">
                <h5 class="schema-title">📋 Output Schema</h5>
                <pre class="schema-preview">${getOutputSchemaPreview(config)}</pre>
            </div>
        </div>
    `;
}

/**
 * Generate output schema preview
 */
function getOutputSchemaPreview(config: PipelineConfig): string {
    const schema: Record<string, string> = {};
    for (const field of config.map.output) {
        schema[field] = 'string | number';
    }

    return JSON.stringify([schema], null, 2);
}

/**
 * Generate resource node details
 */
export function getResourceDetails(resource: ResourceFileInfo): string {
    return `
        <div class="detail-section active">
            <h4 class="detail-title">📁 Resource File</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Name:</span>
                    <span class="detail-value">${escapeHtml(resource.fileName)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Path:</span>
                    <span class="detail-value file-link" data-path="${escapeHtml(resource.filePath)}">${escapeHtml(resource.relativePath)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Type:</span>
                    <span class="detail-value">${resource.fileType.toUpperCase()}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Size:</span>
                    <span class="detail-value">${formatFileSize(resource.size)}</span>
                </div>
            </div>
            <div class="resource-actions">
                <button class="btn btn-secondary" onclick="openFile('${escapeHtml(resource.filePath)}')">
                    Open File
                </button>
            </div>
        </div>
    `;
}

/**
 * Get CSS styles
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
            gap: 8px;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-color);
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

        .toolbar-btn:hover:not(:disabled) {
            background: var(--hover-bg);
        }

        .toolbar-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
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

        .header-description {
            margin: 0 0 12px 0;
            color: ${isDark ? '#9d9d9d' : '#666666'};
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

        .status-valid {
            color: var(--success-color);
        }

        .status-error {
            color: var(--error-color);
        }

        /* Validation */
        .validation-errors,
        .validation-warnings {
            margin-top: 12px;
            padding: 12px;
            border-radius: 4px;
        }

        .validation-errors {
            background: ${isDark ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'};
            border: 1px solid var(--error-color);
        }

        .validation-warnings {
            background: ${isDark ? 'rgba(255, 152, 0, 0.1)' : 'rgba(255, 152, 0, 0.05)'};
            border: 1px solid var(--warning-color);
        }

        .validation-title {
            font-weight: 600;
            margin-bottom: 8px;
        }

        .validation-list {
            margin: 0;
            padding-left: 20px;
        }

        .validation-list li {
            margin: 4px 0;
        }

        /* Diagram */
        .diagram-section {
            margin-bottom: 20px;
        }

        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 12px 0;
            color: var(--text-color);
        }

        .diagram-container {
            background: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            overflow-x: auto;
        }

        .diagram-hint {
            text-align: center;
            font-size: 11px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
            margin: 8px 0 0 0;
        }

        .mermaid {
            display: inline-block;
        }

        /* Make mermaid nodes clickable */
        .mermaid .node {
            cursor: pointer;
        }

        .mermaid .node:hover rect,
        .mermaid .node:hover polygon {
            filter: brightness(1.1);
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
        }

        .detail-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 12px;
            margin-bottom: 16px;
        }

        .detail-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .detail-label {
            font-size: 11px;
            font-weight: 500;
            color: ${isDark ? '#9d9d9d' : '#666666'};
            text-transform: uppercase;
        }

        .detail-value {
            font-size: 13px;
        }

        .file-link {
            color: var(--accent-color);
            cursor: pointer;
            text-decoration: underline;
        }

        .file-link:hover {
            text-decoration: none;
        }

        /* CSV Preview */
        .csv-preview {
            margin-top: 16px;
        }

        .preview-title {
            font-size: 12px;
            font-weight: 600;
            margin: 0 0 8px 0;
        }

        .table-container {
            overflow-x: auto;
            max-height: 200px;
        }

        .preview-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }

        .preview-table th,
        .preview-table td {
            padding: 8px 12px;
            text-align: left;
            border: 1px solid var(--border-color);
        }

        .preview-table th {
            background: ${isDark ? '#333' : '#f0f0f0'};
            font-weight: 600;
            position: sticky;
            top: 0;
        }

        .preview-table td {
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* Output fields */
        .output-fields {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }

        .field-tag {
            display: inline-block;
            padding: 2px 8px;
            background: var(--accent-color);
            color: white;
            border-radius: 12px;
            font-size: 11px;
        }

        /* Prompt section */
        .prompt-section,
        .variables-section,
        .output-schema {
            margin-top: 16px;
        }

        .prompt-title,
        .variables-title,
        .schema-title {
            font-size: 12px;
            font-weight: 600;
            margin: 0 0 8px 0;
        }

        .prompt-template,
        .schema-preview {
            background: ${isDark ? '#1e1e1e' : '#ffffff'};
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 12px;
            margin: 0;
            overflow-x: auto;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* Variables list */
        .variables-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }

        .variables-list li {
            padding: 6px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .variables-list code {
            background: var(--code-bg);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Consolas', 'Monaco', monospace;
        }

        .variable-found .variable-source {
            color: ${isDark ? '#9d9d9d' : '#666666'};
            font-size: 11px;
        }

        .variable-missing {
            color: var(--error-color);
        }

        .variable-warning {
            font-size: 11px;
        }

        /* Resource actions */
        .resource-actions {
            margin-top: 16px;
        }

        .btn {
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            border: none;
        }

        .btn-secondary {
            background: var(--border-color);
            color: var(--text-color);
        }

        .btn-secondary:hover {
            background: var(--hover-bg);
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
 * Get JavaScript for the webview
 */
function getScript(data: PipelinePreviewData | undefined, isDark: boolean): string {
    return `
        const vscode = acquireVsCodeApi();
        
        // Initialize mermaid
        mermaid.initialize({
            startOnLoad: true,
            theme: '${isDark ? 'dark' : 'default'}',
            securityLevel: 'loose',
            flowchart: {
                useMaxWidth: true,
                htmlLabels: true,
                curve: 'basis',
                padding: 15
            }
        });

        // Parse pipeline data
        const dataElement = document.getElementById('pipelineData');
        const pipelineData = dataElement ? JSON.parse(dataElement.textContent) : null;

        // Node click handler - called by mermaid click callbacks
        window.nodeClick = function(nodeId) {
            const detailsContent = document.getElementById('detailsContent');
            if (!detailsContent || !pipelineData) return;
            
            let html = '';
            const config = pipelineData.config;
            const csvInfo = pipelineData.csvInfo;
            const csvPreview = pipelineData.csvPreview;
            const resources = pipelineData.resources || [];
            
            if (nodeId === 'INPUT') {
                html = generateInputDetails(config, csvInfo, csvPreview);
            } else if (nodeId === 'MAP') {
                html = generateMapDetails(config, csvInfo?.headers);
            } else if (nodeId === 'REDUCE') {
                html = generateReduceDetails(config, csvInfo?.rowCount);
            } else if (nodeId.startsWith('RES')) {
                const idx = parseInt(nodeId.replace('RES', ''), 10);
                const filteredResources = resources.filter(r => 
                    r.relativePath !== config.input.path && 
                    r.fileName !== config.input.path
                );
                if (filteredResources[idx]) {
                    html = generateResourceDetails(filteredResources[idx]);
                }
            }
            
            if (html) {
                detailsContent.innerHTML = html;
                attachFileClickHandlers();
            }
            
            // Notify extension
            vscode.postMessage({
                type: 'nodeClick',
                payload: { nodeId }
            });
        };

        // Generate details HTML functions
        function generateInputDetails(config, csvInfo, csvPreview) {
            const headers = csvInfo?.headers || [];
            const rowCount = csvInfo?.rowCount || 0;
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">📥 INPUT Configuration</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Type:</span><span class="detail-value">' + config.input.type.toUpperCase() + '</span></div>';
            html += '<div class="detail-item"><span class="detail-label">File:</span><span class="detail-value file-link" data-path="' + escapeHtml(config.input.path) + '">' + escapeHtml(config.input.path) + '</span></div>';
            
            if (csvInfo) {
                html += '<div class="detail-item"><span class="detail-label">Rows:</span><span class="detail-value">' + rowCount + '</span></div>';
                html += '<div class="detail-item"><span class="detail-label">Columns:</span><span class="detail-value">' + headers.join(', ') + '</span></div>';
            }
            
            html += '</div>';
            
            if (csvPreview && csvPreview.length > 0) {
                html += generateCSVPreviewTable(headers, csvPreview);
            }
            
            html += '</div>';
            return html;
        }

        function generateMapDetails(config, headers) {
            const parallel = config.map.parallel || 5;
            const variables = extractTemplateVariables(config.map.prompt);
            const headerSet = new Set(headers || []);
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">🔄 MAP Configuration</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Parallelism:</span><span class="detail-value">' + parallel + ' concurrent AI calls</span></div>';
            
            if (config.map.model) {
                html += '<div class="detail-item"><span class="detail-label">Model:</span><span class="detail-value">' + escapeHtml(config.map.model) + '</span></div>';
            }
            
            html += '<div class="detail-item"><span class="detail-label">Output Fields:</span><span class="detail-value output-fields">';
            config.map.output.forEach(o => {
                html += '<span class="field-tag">' + escapeHtml(o) + '</span>';
            });
            html += '</span></div></div>';
            
            // Prompt template
            html += '<div class="prompt-section">';
            html += '<h5 class="prompt-title">📝 Prompt Template</h5>';
            html += '<pre class="prompt-template">' + escapeHtml(config.map.prompt) + '</pre>';
            html += '</div>';
            
            // Variables
            html += '<div class="variables-section">';
            html += '<h5 class="variables-title">🔗 Template Variables</h5>';
            html += '<ul class="variables-list">';
            variables.forEach(v => {
                const isMissing = headers && !headerSet.has(v);
                const cssClass = isMissing ? 'variable-missing' : 'variable-found';
                html += '<li class="' + cssClass + '">';
                html += '<code>{{' + escapeHtml(v) + '}}</code>';
                html += isMissing 
                    ? '<span class="variable-warning">⚠️ Not found in CSV</span>'
                    : '<span class="variable-source">← from input column</span>';
                html += '</li>';
            });
            html += '</ul></div></div>';
            
            return html;
        }

        function generateReduceDetails(config, rowCount) {
            const reduceDescriptions = {
                'json': 'Outputs all results as a JSON array',
                'list': 'Outputs results as a formatted list',
                'csv': 'Outputs results as CSV format',
                'markdown': 'Outputs results as Markdown document',
                'summary': 'Generates a summary of all results'
            };
            const description = reduceDescriptions[config.reduce.type] || 'Custom output format';
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">📤 REDUCE Configuration</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Type:</span><span class="detail-value">' + config.reduce.type + '</span></div>';
            html += '<div class="detail-item"><span class="detail-label">Format:</span><span class="detail-value">' + description + '</span></div>';
            
            if (rowCount) {
                html += '<div class="detail-item"><span class="detail-label">Expected Output:</span><span class="detail-value">' + rowCount + ' items (one per input row)</span></div>';
            }
            
            html += '</div>';
            
            // Output schema
            html += '<div class="output-schema">';
            html += '<h5 class="schema-title">📋 Output Schema</h5>';
            const schema = {};
            config.map.output.forEach(f => { schema[f] = 'string | number'; });
            html += '<pre class="schema-preview">' + JSON.stringify([schema], null, 2) + '</pre>';
            html += '</div></div>';
            
            return html;
        }

        function generateResourceDetails(resource) {
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">📁 Resource File</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Name:</span><span class="detail-value">' + escapeHtml(resource.fileName) + '</span></div>';
            html += '<div class="detail-item"><span class="detail-label">Path:</span><span class="detail-value file-link" data-path="' + escapeHtml(resource.filePath) + '">' + escapeHtml(resource.relativePath) + '</span></div>';
            html += '<div class="detail-item"><span class="detail-label">Type:</span><span class="detail-value">' + resource.fileType.toUpperCase() + '</span></div>';
            html += '<div class="detail-item"><span class="detail-label">Size:</span><span class="detail-value">' + formatFileSize(resource.size) + '</span></div>';
            html += '</div>';
            html += '<div class="resource-actions">';
            html += '<button class="btn btn-secondary" onclick="openFile(\\'' + escapeHtml(resource.filePath) + '\\')">Open File</button>';
            html += '</div></div>';
            return html;
        }

        function generateCSVPreviewTable(headers, preview) {
            let html = '<div class="csv-preview">';
            html += '<h5 class="preview-title">📊 Preview (first ' + preview.length + ' rows)</h5>';
            html += '<div class="table-container"><table class="preview-table">';
            html += '<thead><tr>';
            headers.forEach(h => { html += '<th>' + escapeHtml(h) + '</th>'; });
            html += '</tr></thead><tbody>';
            preview.forEach(row => {
                html += '<tr>';
                headers.forEach(h => { html += '<td>' + escapeHtml(String(row[h] || '')) + '</td>'; });
                html += '</tr>';
            });
            html += '</tbody></table></div></div>';
            return html;
        }

        function extractTemplateVariables(prompt) {
            const regex = /\\{\\{(\\w+)\\}\\}/g;
            const variables = [];
            let match;
            while ((match = regex.exec(prompt)) !== null) {
                if (!variables.includes(match[1])) {
                    variables.push(match[1]);
                }
            }
            return variables;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }

        // Open file handler
        window.openFile = function(filePath) {
            vscode.postMessage({
                type: 'openFile',
                payload: { filePath }
            });
        };

        // Toolbar button handlers
        document.getElementById('editBtn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'edit' });
        });

        document.getElementById('executeBtn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'execute' });
        });

        document.getElementById('validateBtn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'validate' });
        });

        document.getElementById('refreshBtn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'refresh' });
        });

        // Attach click handlers to file links
        function attachFileClickHandlers() {
            document.querySelectorAll('.file-link').forEach(el => {
                el.addEventListener('click', () => {
                    const filePath = el.getAttribute('data-path');
                    if (filePath) {
                        openFile(filePath);
                    }
                });
            });
        }

        // Initial setup
        attachFileClickHandlers();
        
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
