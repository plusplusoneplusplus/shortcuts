/**
 * Pipeline Preview Content Generator
 *
 * Generates HTML content for the Pipeline Preview webview panel.
 * Uses Mermaid.js for diagram rendering with interactive node clicks.
 *
 * Uses shared webview utilities:
 * - WebviewSetupHelper for nonce generation and HTML escaping
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as vscode from 'vscode';
import { PipelineConfig, CSVParseResult, PromptItem, isCSVSource, isGenerateConfig } from '../types';
import { PipelineInfo, ResourceFileInfo, ValidationResult } from './types';
import {
    generatePipelineMermaid,
    extractTemplateVariables,
    validateTemplateVariables,
    formatFileSize,
    PipelineNodeType
} from './preview-mermaid';
import { GenerateState, GeneratedItem } from '../input-generator';
import { WebviewSetupHelper } from '../../shared/webview/extension-webview-utils';

/**
 * Message types for webview communication (from webview to extension)
 */
export type PreviewMessageType =
    | 'nodeClick'
    | 'execute'
    | 'validate'
    | 'edit'
    | 'refresh'
    | 'openFile'
    | 'ready'
    // Generate flow messages
    | 'generate'
    | 'regenerate'
    | 'cancelGenerate'
    | 'addRow'
    | 'deleteRows'
    | 'updateCell'
    | 'toggleRow'
    | 'toggleAll'
    | 'runWithItems'
    // CSV preview messages
    | 'toggleShowAllRows';

/**
 * Message types from extension to webview
 */
export type ExtensionMessageType =
    | 'updateGenerateState';

/**
 * Message from extension to webview
 */
export interface ExtensionMessage {
    type: ExtensionMessageType;
    payload?: {
        generateState?: GenerateState;
        generatedItems?: GeneratedItem[];
    };
}

/**
 * Message from webview to extension
 */
export interface PreviewMessage {
    type: PreviewMessageType;
    payload?: {
        nodeId?: string;
        nodeType?: PipelineNodeType;
        filePath?: string;
        // Generate flow payloads
        indices?: number[];
        index?: number;
        field?: string;
        value?: string;
        selected?: boolean;
        items?: PromptItem[];
        // CSV preview payloads
        showAllRows?: boolean;
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
    /** All CSV items (for "show all rows" feature) */
    csvAllItems?: PromptItem[];
    /** Generate state (for pipelines with input.generate) */
    generateState?: GenerateState;
    /** Generated items with selection state */
    generatedItems?: GeneratedItem[];
    /** Whether to show all rows in CSV preview (default: false) */
    showAllRows?: boolean;
}

/**
 * Generate HTML content for the Pipeline Preview webview
 */
export function getPreviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    data?: PipelinePreviewData
): string {
    // Use shared helper for nonce generation
    const nonce = WebviewSetupHelper.generateNonce();
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
    const { config, info, validation, csvInfo, csvPreview, generateState, generatedItems, csvAllItems, showAllRows } = data;

    // Check if this is a generate pipeline
    const hasGenerateConfig = isGenerateConfig(config.input?.generate);

    // Generate mermaid diagram
    const mermaidDiagram = generatePipelineMermaid(
        config,
        csvInfo,
        info.resourceFiles,
        { theme: isDark ? 'dark' : 'default', showCounts: true }
    );

    return `
        ${getToolbar(info, validation, hasGenerateConfig, generateState)}
        ${getHeader(info, validation)}
        ${getDiagramSection(mermaidDiagram)}
        ${getDetailsPanel(config, csvInfo, csvPreview, info, generateState, generatedItems, csvAllItems, showAllRows)}
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
function getToolbar(
    info: PipelineInfo,
    validation: ValidationResult,
    hasGenerateConfig?: boolean,
    generateState?: GenerateState
): string {
    // Determine which execute button to show based on generate state
    let executeButton: string;

    if (hasGenerateConfig) {
        const status = generateState?.status || 'initial';
        if (status === 'initial' || status === 'error') {
            executeButton = `
                <button class="toolbar-btn toolbar-btn-primary" id="generateBtn" title="Generate & Review Items" ${!validation.valid ? 'disabled' : ''}>
                    <span class="icon">▶️</span> Generate & Review
                </button>
            `;
        } else if (status === 'generating') {
            executeButton = `
                <button class="toolbar-btn" disabled>
                    <span class="icon">⏳</span> Generating...
                </button>
            `;
        } else {
            // status === 'review'
            executeButton = `
                <button class="toolbar-btn" id="regenerateBtn" title="Regenerate Items">
                    <span class="icon">🔄</span> Regenerate
                </button>
            `;
        }
    } else {
        executeButton = `
            <button class="toolbar-btn" id="executeBtn" title="Execute Pipeline" ${!validation.valid ? 'disabled' : ''}>
                <span class="icon">▶️</span> Execute
            </button>
        `;
    }

    return `
        <div class="toolbar">
            <button class="toolbar-btn" id="editBtn" title="Edit Pipeline">
                <span class="icon">✏️</span> Edit
            </button>
            ${executeButton}
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
            <div class="diagram-header">
                <h3 class="section-title">Pipeline Flow</h3>
                <div class="diagram-zoom-controls">
                    <button class="diagram-zoom-btn" id="zoomOutBtn" title="Zoom out (Ctrl+Scroll down)">−</button>
                    <span class="diagram-zoom-level" id="zoomLevel">100%</span>
                    <button class="diagram-zoom-btn" id="zoomInBtn" title="Zoom in (Ctrl+Scroll up)">+</button>
                    <button class="diagram-zoom-btn diagram-zoom-reset" id="zoomResetBtn" title="Reset zoom">⟲</button>
                </div>
            </div>
            <div class="diagram-container" id="diagramContainer">
                <div class="diagram-wrapper" id="diagramWrapper">
                    <div class="mermaid" id="pipelineDiagram">
${mermaidDiagram}
                    </div>
                </div>
            </div>
            <p class="diagram-hint">Click on a node to see details • Ctrl+Scroll to zoom • Drag to pan</p>
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
    info?: PipelineInfo,
    generateState?: GenerateState,
    generatedItems?: GeneratedItem[],
    csvAllItems?: PromptItem[],
    showAllRows?: boolean
): string {
    // Determine initial details content based on generate state
    let initialContent: string;
    const hasGenerateConfig = isGenerateConfig(config.input?.generate);

    if (hasGenerateConfig && generateState) {
        switch (generateState.status) {
            case 'generating':
                initialContent = getGeneratingStateContent();
                break;
            case 'review':
                initialContent = getReviewTableContent(config, generateState.items);
                break;
            case 'error':
                initialContent = getGenerateErrorContent(generateState.message);
                break;
            default:
                initialContent = getGenerateConfigDetails(config);
        }
    } else {
        initialContent = getInputDetails(config, csvInfo, csvPreview, true, csvAllItems, showAllRows);
    }

    return `
        <div class="details-panel" id="detailsPanel">
            <div class="details-content" id="detailsContent">
                ${initialContent}
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
                csvAllItems: csvAllItems || null,
                showAllRows: showAllRows || false,
                resources: info?.resourceFiles || [],
                hasGenerateConfig,
                generateState: generateState || null,
                generatedItems: generatedItems || null
            })}
        </script>
    `;
}

/**
 * Generate details for a generate config (initial state)
 */
function getGenerateConfigDetails(config: PipelineConfig): string {
    const generateConfig = config.input?.generate;
    if (!generateConfig) return '';

    const modelHtml = generateConfig.model 
        ? `
                <div class="detail-item">
                    <span class="detail-label">Model:</span>
                    <span class="detail-value">${escapeHtml(generateConfig.model)}</span>
                </div>`
        : '';

    return `
        <div class="detail-section active">
            <h4 class="detail-title">🤖 AI-GENERATED Input Configuration</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Type:</span>
                    <span class="detail-value">AI-GENERATED</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Schema:</span>
                    <span class="detail-value">${escapeHtml(generateConfig.schema.join(', '))}</span>
                </div>${modelHtml}
            </div>
            
            <div class="prompt-section">
                <h5 class="prompt-title">📝 Generation Prompt</h5>
                <pre class="prompt-template">${escapeHtml(generateConfig.prompt)}</pre>
            </div>
            
            <div class="generate-status">
                <p class="status-text">Status: Not generated yet</p>
                <p class="status-hint">Click "Generate & Review" to generate items using AI.</p>
            </div>
        </div>
    `;
}

/**
 * Generate loading state content
 */
function getGeneratingStateContent(): string {
    return `
        <div class="detail-section active">
            <h4 class="detail-title">🤖 Generating Inputs</h4>
            <div class="generating-container">
                <div class="generating-spinner"></div>
                <p class="generating-text">Generating items from AI...</p>
                <button class="btn btn-secondary" id="cancelGenerateBtn">Cancel</button>
            </div>
        </div>
    `;
}

/**
 * Generate error state content
 */
function getGenerateErrorContent(message: string): string {
    return `
        <div class="detail-section active">
            <h4 class="detail-title">⚠️ Generation Error</h4>
            <div class="generate-error">
                <p class="error-message">${escapeHtml(message)}</p>
                <p class="error-hint">Click "Generate & Review" to try again.</p>
            </div>
        </div>
    `;
}

/**
 * Generate the review table content with editable items
 */
function getReviewTableContent(config: PipelineConfig, items: GeneratedItem[]): string {
    const generateConfig = config.input?.generate;
    if (!generateConfig) return '';

    const schema = generateConfig.schema;
    const selectedCount = items.filter(i => i.selected).length;
    const allSelected = selectedCount === items.length;

    return `
        <div class="detail-section active">
            <h4 class="detail-title">✅ Review Generated Inputs</h4>
            
            <div class="review-toolbar">
                <button class="btn btn-secondary" id="addRowBtn">
                    <span class="icon">+</span> Add
                </button>
                <button class="btn btn-secondary" id="deleteSelectedBtn">
                    Delete Selected
                </button>
            </div>
            
            <div class="table-container review-table-container">
                <table class="preview-table review-table" id="reviewTable">
                    <thead>
                        <tr>
                            <th class="checkbox-col">
                                <input type="checkbox" id="selectAllCheckbox" ${allSelected ? 'checked' : ''}>
                            </th>
                            ${schema.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map((item, idx) => `
                            <tr data-index="${idx}">
                                <td class="checkbox-col">
                                    <input type="checkbox" class="row-checkbox" data-index="${idx}" ${item.selected ? 'checked' : ''}>
                                </td>
                                ${schema.map(field => `
                                    <td>
                                        <input type="text" class="cell-input" 
                                            data-index="${idx}" 
                                            data-field="${escapeHtml(field)}" 
                                            value="${escapeHtml(String(item.data[field] || ''))}"
                                        >
                                    </td>
                                `).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <div class="review-footer">
                <label class="select-all-label">
                    <input type="checkbox" id="selectAllFooter" ${allSelected ? 'checked' : ''}>
                    Select All (${selectedCount}/${items.length} selected)
                </label>
                
                <div class="review-actions">
                    <button class="btn btn-secondary" id="cancelReviewBtn">Cancel</button>
                    <button class="btn btn-primary" id="runPipelineBtn" ${selectedCount === 0 ? 'disabled' : ''}>
                        ▶️ Run Pipeline (${selectedCount} items)
                    </button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Generate INPUT node details
 */
export function getInputDetails(
    config: PipelineConfig,
    csvInfo?: CSVParseResult,
    csvPreview?: PromptItem[],
    initial: boolean = false,
    csvAllItems?: PromptItem[],
    showAllRows?: boolean
): string {
    const headers = csvInfo?.headers || [];
    const rowCount = csvInfo?.rowCount || 0;
    
    // Determine input type and path based on new config structure
    const hasInlineItems = config.input.items && config.input.items.length > 0;
    const hasCSVSource = isCSVSource(config.input.from);
    const hasInlineArrayFrom = Array.isArray(config.input.from);
    const inputType = hasInlineItems ? 'INLINE' : (hasCSVSource ? 'CSV' : (hasInlineArrayFrom ? 'INLINE_ARRAY' : 'UNKNOWN'));
    const csvPath = hasCSVSource ? (config.input.from as { path: string }).path : '';
    const delimiter = hasCSVSource ? (config.input.from as { delimiter?: string }).delimiter : undefined;
    const itemCount = hasInlineItems ? config.input.items!.length : (hasInlineArrayFrom ? (config.input.from as PromptItem[]).length : rowCount);
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
            ${csvPreview && csvPreview.length > 0 ? getCSVPreviewTable(headers, csvPreview, rowCount, csvAllItems, showAllRows) : ''}
        </div>
    `;
}

/**
 * Generate CSV preview table with optional "show all rows" functionality
 * @param headers CSV column headers
 * @param preview Preview items (first N rows)
 * @param totalRowCount Total number of rows in the CSV
 * @param allItems All items (used when showAllRows is true)
 * @param showAllRows Whether to show all rows or just preview
 */
function getCSVPreviewTable(
    headers: string[],
    preview: PromptItem[],
    totalRowCount?: number,
    allItems?: PromptItem[],
    showAllRows?: boolean
): string {
    const displayItems = showAllRows && allItems ? allItems : preview;
    const previewCount = preview.length;
    const hasMoreRows = totalRowCount !== undefined && totalRowCount > previewCount;
    
    // Title text varies based on whether we're showing all rows
    const titleText = showAllRows 
        ? `📊 All ${totalRowCount} rows`
        : `📊 Preview (first ${previewCount} rows)`;
    
    // Show "Show All" button only if there are more rows and not already showing all
    const showAllButton = hasMoreRows && !showAllRows
        ? `<button class="btn btn-secondary btn-show-all" id="showAllRowsBtn" title="Show all ${totalRowCount} rows">Show All (${totalRowCount})</button>`
        : '';
    
    // Show "Collapse" button when showing all rows
    const collapseButton = showAllRows && hasMoreRows
        ? `<button class="btn btn-secondary btn-show-all" id="collapseRowsBtn" title="Show preview only">Collapse</button>`
        : '';

    return `
        <div class="csv-preview">
            <div class="preview-header">
                <h5 class="preview-title">${titleText}</h5>
                ${showAllButton}${collapseButton}
            </div>
            <div class="table-container${showAllRows ? ' table-container-expanded' : ''}">
                <table class="preview-table">
                    <thead>
                        <tr>
                            ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${displayItems.map(row => `
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
                    <span class="detail-value output-fields">${(config.map.output || []).length > 0
                        ? (config.map.output || []).map(o => `<span class="field-tag">${escapeHtml(o)}</span>`).join('')
                        : '<span class="field-tag text-mode">text (raw)</span>'}</span>
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
        'summary': 'Generates a summary of all results',
        'ai': 'AI-powered synthesis of results',
        'text': 'Plain text concatenation'
    };

    const description = reduceDescriptions[config.reduce.type] || 'Custom output format';
    const isAIReduce = config.reduce.type === 'ai';

    return `
        <div class="detail-section active">
            <h4 class="detail-title">📤 REDUCE Configuration</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <span class="detail-label">Type:</span>
                    <span class="detail-value">${config.reduce.type.toUpperCase()}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Format:</span>
                    <span class="detail-value">${description}</span>
                </div>
                ${config.reduce.model ? `
                <div class="detail-item">
                    <span class="detail-label">Model:</span>
                    <span class="detail-value">${escapeHtml(config.reduce.model)}</span>
                </div>
                ` : ''}
                ${rowCount ? `
                <div class="detail-item">
                    <span class="detail-label">Input Items:</span>
                    <span class="detail-value">${rowCount} items from map phase</span>
                </div>
                ` : ''}
                ${isAIReduce && config.reduce.output && config.reduce.output.length > 0 ? `
                <div class="detail-item">
                    <span class="detail-label">Output Fields:</span>
                    <span class="detail-value output-fields">${config.reduce.output.map(o => `<span class="field-tag">${escapeHtml(o)}</span>`).join('')}</span>
                </div>
                ` : ''}
            </div>
            ${isAIReduce && config.reduce.prompt ? `
            <div class="prompt-section">
                <h5 class="prompt-title">📝 AI Reduce Prompt</h5>
                <pre class="prompt-template">${escapeHtml(config.reduce.prompt)}</pre>
            </div>
            
            <div class="variables-section">
                <h5 class="variables-title">🔗 Available Template Variables</h5>
                <ul class="variables-list">
                    <li class="variable-found"><code>{{RESULTS}}</code><span class="variable-source">← All successful map outputs (JSON array)</span></li>
                    <li class="variable-found"><code>{{RESULTS_FILE}}</code><span class="variable-source">← Path to temp file with results (for large data)</span></li>
                    <li class="variable-found"><code>{{COUNT}}</code><span class="variable-source">← Total number of results</span></li>
                    <li class="variable-found"><code>{{SUCCESS_COUNT}}</code><span class="variable-source">← Number of successful items</span></li>
                    <li class="variable-found"><code>{{FAILURE_COUNT}}</code><span class="variable-source">← Number of failed items</span></li>
                </ul>
            </div>
            ` : `
            <div class="output-schema">
                <h5 class="schema-title">📋 Output Schema</h5>
                <pre class="schema-preview">${getOutputSchemaPreview(config)}</pre>
            </div>
            `}
        </div>
    `;
}

/**
 * Generate output schema preview
 */
function getOutputSchemaPreview(config: PipelineConfig): string {
    const outputFields = config.map.output || [];
    if (outputFields.length === 0) {
        // Text mode - no structured schema
        return '"raw text output"';
    }

    const schema: Record<string, string> = {};
    for (const field of outputFields) {
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

        .diagram-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0;
            color: var(--text-color);
        }

        .diagram-zoom-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            background: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 2px 6px;
        }

        .diagram-zoom-btn {
            width: 24px;
            height: 24px;
            border: none;
            background: transparent;
            color: var(--text-color);
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }

        .diagram-zoom-btn:hover {
            background: var(--hover-bg);
        }

        .diagram-zoom-btn:active {
            background: var(--border-color);
        }

        .diagram-zoom-level {
            font-size: 11px;
            min-width: 40px;
            text-align: center;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        .diagram-zoom-reset {
            margin-left: 4px;
            border-left: 1px solid var(--border-color);
            padding-left: 8px;
        }

        .diagram-container {
            background: var(--code-bg);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            overflow: hidden;
            position: relative;
            cursor: grab;
            min-height: 200px;
        }

        .diagram-container:active {
            cursor: grabbing;
        }

        .diagram-container.dragging {
            cursor: grabbing;
        }

        .diagram-wrapper {
            display: inline-block;
            transform-origin: center center;
            transition: transform 0.1s ease-out;
        }

        .diagram-wrapper.no-transition {
            transition: none;
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

        .preview-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .preview-title {
            font-size: 12px;
            font-weight: 600;
            margin: 0;
        }

        .btn-show-all {
            padding: 4px 10px;
            font-size: 11px;
        }

        .table-container {
            overflow-x: auto;
            max-height: 200px;
            overflow-y: auto;
        }

        .table-container-expanded {
            max-height: 500px;
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
            z-index: 1;
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

        .field-tag.text-mode {
            background: ${isDark ? '#666' : '#999'};
            font-style: italic;
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

        /* Primary button style */
        .toolbar-btn-primary {
            background: var(--accent-color);
            color: white;
            border-color: var(--accent-color);
        }

        .toolbar-btn-primary:hover:not(:disabled) {
            filter: brightness(1.1);
        }

        .btn-primary {
            background: var(--accent-color);
            color: white;
        }

        .btn-primary:hover:not(:disabled) {
            filter: brightness(1.1);
        }

        .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* Generate status */
        .generate-status {
            margin-top: 16px;
            padding: 12px;
            background: ${isDark ? 'rgba(86, 156, 214, 0.1)' : 'rgba(0, 102, 204, 0.05)'};
            border: 1px solid var(--accent-color);
            border-radius: 4px;
        }

        .status-text {
            margin: 0 0 4px 0;
            font-weight: 500;
        }

        .status-hint {
            margin: 0;
            font-size: 12px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        /* Generating state */
        .generating-container {
            text-align: center;
            padding: 40px 20px;
        }

        .generating-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid var(--border-color);
            border-top-color: var(--accent-color);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .generating-text {
            margin: 0 0 16px 0;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        /* Generate error */
        .generate-error {
            padding: 12px;
            background: ${isDark ? 'rgba(244, 67, 54, 0.1)' : 'rgba(244, 67, 54, 0.05)'};
            border: 1px solid var(--error-color);
            border-radius: 4px;
        }

        .error-message {
            margin: 0 0 8px 0;
            color: var(--error-color);
        }

        .error-hint {
            margin: 0;
            font-size: 12px;
            color: ${isDark ? '#9d9d9d' : '#666666'};
        }

        /* Review table */
        .review-toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }

        .review-toolbar .btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .review-table-container {
            max-height: 400px;
            margin-bottom: 16px;
        }

        .review-table .checkbox-col {
            width: 40px;
            text-align: center;
        }

        .review-table input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }

        .review-table .cell-input {
            width: 100%;
            padding: 4px 8px;
            border: 1px solid transparent;
            background: transparent;
            color: var(--text-color);
            font-size: 12px;
            font-family: inherit;
        }

        .review-table .cell-input:focus {
            border-color: var(--accent-color);
            outline: none;
            background: ${isDark ? '#1e1e1e' : '#ffffff'};
        }

        .review-table tr:hover .cell-input {
            background: ${isDark ? '#2a2d2e' : '#f5f5f5'};
        }

        /* Review footer */
        .review-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 12px;
            border-top: 1px solid var(--border-color);
        }

        .select-all-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            cursor: pointer;
        }

        .review-actions {
            display: flex;
            gap: 8px;
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
            const csvAllItems = pipelineData.csvAllItems;
            const showAllRows = pipelineData.showAllRows;
            const resources = pipelineData.resources || [];
            const generateState = pipelineData.generateState;
            const generatedItems = pipelineData.generatedItems;
            
            if (nodeId === 'GENERATE') {
                // Show generate configuration details
                html = generateGenerateDetails(config, generateState, generatedItems);
            } else if (nodeId === 'INPUT') {
                // Check if this is a generate config or regular input
                if (config.input && config.input.generate) {
                    html = generateGenerateInputDetails(config, generateState, generatedItems);
                } else {
                    html = generateInputDetails(config, csvInfo, csvPreview, csvAllItems, showAllRows);
                }
            } else if (nodeId === 'MAP') {
                html = generateMapDetails(config, csvInfo?.headers);
            } else if (nodeId === 'REDUCE') {
                html = generateReduceDetails(config, csvInfo?.rowCount);
            } else if (nodeId.startsWith('RES')) {
                const idx = parseInt(nodeId.replace('RES', ''), 10);
                const inputPath = config.input?.from?.path || config.input?.path;
                const filteredResources = resources.filter(r => 
                    r.relativePath !== inputPath && 
                    r.fileName !== inputPath
                );
                if (filteredResources[idx]) {
                    html = generateResourceDetails(filteredResources[idx]);
                }
            }
            
            if (html) {
                detailsContent.innerHTML = html;
                attachFileClickHandlers();
                // Re-attach review table handlers if we rendered the review table
                attachReviewTableHandlers();
                // Re-attach show all rows handlers
                attachShowAllRowsHandlers();
            }
            
            // Notify extension
            vscode.postMessage({
                type: 'nodeClick',
                payload: { nodeId }
            });
        };

        // Generate details HTML functions
        function generateInputDetails(config, csvInfo, csvPreview, csvAllItems, showAllRows) {
            const headers = csvInfo?.headers || [];
            const rowCount = csvInfo?.rowCount || 0;
            
            // Determine input type and path based on new config structure
            const hasInlineItems = config.input.items && config.input.items.length > 0;
            const hasCSVSource = config.input.from && typeof config.input.from === 'object' && 'path' in config.input.from;
            const hasInlineArrayFrom = Array.isArray(config.input.from);
            const inputType = hasInlineItems ? 'INLINE' : (hasCSVSource ? 'CSV' : (hasInlineArrayFrom ? 'INLINE_ARRAY' : 'UNKNOWN'));
            const csvPath = hasCSVSource ? config.input.from.path : '';
            const delimiter = hasCSVSource ? config.input.from.delimiter : undefined;
            const itemCount = hasInlineItems ? config.input.items.length : (hasInlineArrayFrom ? config.input.from.length : rowCount);
            const limit = config.input.limit;
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">📥 INPUT Configuration</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Type:</span><span class="detail-value">' + inputType + '</span></div>';
            
            if (hasCSVSource) {
                html += '<div class="detail-item"><span class="detail-label">File:</span><span class="detail-value file-link" data-path="' + escapeHtml(csvPath) + '">' + escapeHtml(csvPath) + '</span></div>';
            }
            
            if (hasInlineItems) {
                html += '<div class="detail-item"><span class="detail-label">Inline Items:</span><span class="detail-value">' + itemCount + ' items</span></div>';
            }
            
            if (csvInfo) {
                html += '<div class="detail-item"><span class="detail-label">Rows:</span><span class="detail-value">' + rowCount + '</span></div>';
                html += '<div class="detail-item"><span class="detail-label">Columns:</span><span class="detail-value">' + headers.join(', ') + '</span></div>';
            }
            
            if (delimiter && delimiter !== ',') {
                html += '<div class="detail-item"><span class="detail-label">Delimiter:</span><span class="detail-value">' + escapeHtml(delimiter) + '</span></div>';
            }
            
            if (limit) {
                html += '<div class="detail-item"><span class="detail-label">Limit:</span><span class="detail-value">' + limit + ' items</span></div>';
            }
            
            html += '</div>';
            
            if (csvPreview && csvPreview.length > 0) {
                html += generateCSVPreviewTable(headers, csvPreview, rowCount, csvAllItems, showAllRows);
            }
            
            html += '</div>';
            return html;
        }

        // Generate details for the GENERATE node (AI input generation config)
        function generateGenerateDetails(config, generateState, generatedItems) {
            const generateConfig = config.input?.generate;
            if (!generateConfig) return '';
            
            // If in review state, show the full review table
            if (generateState && generateState.status === 'review' && generatedItems && generatedItems.length > 0) {
                return generateReviewTableContent(config, generatedItems);
            }
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">🤖 GENERATE Configuration</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Type:</span><span class="detail-value">AI Input Generation</span></div>';
            html += '<div class="detail-item"><span class="detail-label">Schema:</span><span class="detail-value">' + escapeHtml(generateConfig.schema.join(', ')) + '</span></div>';
            
            if (generateConfig.model) {
                html += '<div class="detail-item"><span class="detail-label">Model:</span><span class="detail-value">' + escapeHtml(generateConfig.model) + '</span></div>';
            }
            
            html += '</div>';
            
            // Prompt
            html += '<div class="prompt-section">';
            html += '<h5 class="prompt-title">📝 Generation Prompt</h5>';
            html += '<pre class="prompt-template">' + escapeHtml(generateConfig.prompt) + '</pre>';
            html += '</div>';
            
            // Status based on generateState
            html += '<div class="generate-status">';
            if (generateState) {
                if (generateState.status === 'initial') {
                    html += '<p class="status-text">Status: Not generated yet</p>';
                    html += '<p class="status-hint">Click "Generate & Review" to generate items using AI.</p>';
                } else if (generateState.status === 'generating') {
                    html += '<p class="status-text">Status: Generating...</p>';
                } else if (generateState.status === 'error') {
                    html += '<p class="status-text status-error">Status: Error - ' + escapeHtml(generateState.message || 'Unknown error') + '</p>';
                }
            } else {
                html += '<p class="status-text">Status: Not generated yet</p>';
            }
            html += '</div>';
            
            html += '</div>';
            return html;
        }

        // Generate details for INPUT node when using generate config
        function generateGenerateInputDetails(config, generateState, generatedItems) {
            const generateConfig = config.input?.generate;
            if (!generateConfig) return '';
            
            // If in review state, show the full review table
            if (generateState && generateState.status === 'review' && generatedItems && generatedItems.length > 0) {
                return generateReviewTableContent(config, generatedItems);
            }
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">📥 INPUT Configuration (AI-GENERATED)</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Type:</span><span class="detail-value">AI-GENERATED</span></div>';
            html += '<div class="detail-item"><span class="detail-label">Schema:</span><span class="detail-value">' + escapeHtml(generateConfig.schema.join(', ')) + '</span></div>';
            html += '</div>';
            
            if (!generateState || generateState.status === 'initial') {
                html += '<p class="status-hint">Items will be shown here after generation.</p>';
            }
            
            html += '</div>';
            return html;
        }

        // Generate the review table content (client-side version)
        function generateReviewTableContent(config, items) {
            const generateConfig = config.input?.generate;
            if (!generateConfig) return '';

            const schema = generateConfig.schema;
            const selectedCount = items.filter(i => i.selected).length;
            const allSelected = selectedCount === items.length;

            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">✅ Review Generated Inputs</h4>';
            
            html += '<div class="review-toolbar">';
            html += '<button class="btn btn-secondary" id="addRowBtn"><span class="icon">+</span> Add</button>';
            html += '<button class="btn btn-secondary" id="deleteSelectedBtn">Delete Selected</button>';
            html += '</div>';
            
            html += '<div class="table-container review-table-container">';
            html += '<table class="preview-table review-table" id="reviewTable">';
            html += '<thead><tr>';
            html += '<th class="checkbox-col"><input type="checkbox" id="selectAllCheckbox" ' + (allSelected ? 'checked' : '') + '></th>';
            schema.forEach(h => { html += '<th>' + escapeHtml(h) + '</th>'; });
            html += '</tr></thead>';
            html += '<tbody>';
            
            items.forEach((item, idx) => {
                html += '<tr data-index="' + idx + '">';
                html += '<td class="checkbox-col"><input type="checkbox" class="row-checkbox" data-index="' + idx + '" ' + (item.selected ? 'checked' : '') + '></td>';
                schema.forEach(field => {
                    html += '<td><input type="text" class="cell-input" data-index="' + idx + '" data-field="' + escapeHtml(field) + '" value="' + escapeHtml(String(item.data[field] || '')) + '"></td>';
                });
                html += '</tr>';
            });
            
            html += '</tbody></table></div>';
            
            html += '<div class="review-footer">';
            html += '<label class="select-all-label"><input type="checkbox" id="selectAllFooter" ' + (allSelected ? 'checked' : '') + '>Select All (' + selectedCount + '/' + items.length + ' selected)</label>';
            html += '<div class="review-actions">';
            html += '<button class="btn btn-secondary" id="cancelReviewBtn">Cancel</button>';
            html += '<button class="btn btn-primary" id="runPipelineBtn" ' + (selectedCount === 0 ? 'disabled' : '') + '>▶️ Run Pipeline (' + selectedCount + ' items)</button>';
            html += '</div></div>';
            
            html += '</div>';
            return html;
        }

        function generateMapDetails(config, headers) {
            const parallel = config.map.parallel || 5;
            const variables = extractTemplateVariables(config.map.prompt);
            const headerSet = new Set(headers || []);
            const outputFields = config.map.output || [];
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">🔄 MAP Configuration</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Parallelism:</span><span class="detail-value">' + parallel + ' concurrent AI calls</span></div>';
            
            if (config.map.model) {
                html += '<div class="detail-item"><span class="detail-label">Model:</span><span class="detail-value">' + escapeHtml(config.map.model) + '</span></div>';
            }
            
            html += '<div class="detail-item"><span class="detail-label">Output Fields:</span><span class="detail-value output-fields">';
            if (outputFields.length > 0) {
                outputFields.forEach(o => {
                    html += '<span class="field-tag">' + escapeHtml(o) + '</span>';
                });
            } else {
                html += '<span class="field-tag text-mode">text (raw)</span>';
            }
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
                'summary': 'Generates a summary of all results',
                'ai': 'AI-powered synthesis of results',
                'text': 'Plain text concatenation'
            };
            const description = reduceDescriptions[config.reduce.type] || 'Custom output format';
            const isAIReduce = config.reduce.type === 'ai';
            
            let html = '<div class="detail-section active">';
            html += '<h4 class="detail-title">📤 REDUCE Configuration</h4>';
            html += '<div class="detail-grid">';
            html += '<div class="detail-item"><span class="detail-label">Type:</span><span class="detail-value">' + config.reduce.type.toUpperCase() + '</span></div>';
            html += '<div class="detail-item"><span class="detail-label">Format:</span><span class="detail-value">' + description + '</span></div>';
            
            if (config.reduce.model) {
                html += '<div class="detail-item"><span class="detail-label">Model:</span><span class="detail-value">' + escapeHtml(config.reduce.model) + '</span></div>';
            }
            
            if (rowCount) {
                html += '<div class="detail-item"><span class="detail-label">Input Items:</span><span class="detail-value">' + rowCount + ' items from map phase</span></div>';
            }
            
            if (isAIReduce && config.reduce.output && config.reduce.output.length > 0) {
                html += '<div class="detail-item"><span class="detail-label">Output Fields:</span><span class="detail-value output-fields">';
                config.reduce.output.forEach(o => {
                    html += '<span class="field-tag">' + escapeHtml(o) + '</span>';
                });
                html += '</span></div>';
            }
            
            html += '</div>';
            
            if (isAIReduce && config.reduce.prompt) {
                // AI Reduce prompt section
                html += '<div class="prompt-section">';
                html += '<h5 class="prompt-title">📝 AI Reduce Prompt</h5>';
                html += '<pre class="prompt-template">' + escapeHtml(config.reduce.prompt) + '</pre>';
                html += '</div>';
                
                // Available template variables
                html += '<div class="variables-section">';
                html += '<h5 class="variables-title">🔗 Available Template Variables</h5>';
                html += '<ul class="variables-list">';
                html += '<li class="variable-found"><code>{{RESULTS}}</code><span class="variable-source">← All successful map outputs (JSON array)</span></li>';
                html += '<li class="variable-found"><code>{{RESULTS_FILE}}</code><span class="variable-source">← Path to temp file with results (for large data)</span></li>';
                html += '<li class="variable-found"><code>{{COUNT}}</code><span class="variable-source">← Total number of results</span></li>';
                html += '<li class="variable-found"><code>{{SUCCESS_COUNT}}</code><span class="variable-source">← Number of successful items</span></li>';
                html += '<li class="variable-found"><code>{{FAILURE_COUNT}}</code><span class="variable-source">← Number of failed items</span></li>';
                html += '</ul></div>';
            } else {
                // Output schema for non-AI reduce
                html += '<div class="output-schema">';
                html += '<h5 class="schema-title">📋 Output Schema</h5>';
                const schema = {};
                const outputFields = config.map.output || [];
                outputFields.forEach(f => { schema[f] = 'string | number'; });
                html += '<pre class="schema-preview">' + JSON.stringify([schema], null, 2) + '</pre>';
                html += '</div>';
            }
            
            html += '</div>';
            
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

        function generateCSVPreviewTable(headers, preview, totalRowCount, allItems, showAllRows) {
            const displayItems = showAllRows && allItems ? allItems : preview;
            const previewCount = preview.length;
            const hasMoreRows = totalRowCount !== undefined && totalRowCount > previewCount;
            
            const titleText = showAllRows 
                ? '📊 All ' + totalRowCount + ' rows'
                : '📊 Preview (first ' + previewCount + ' rows)';
            
            const showAllButton = hasMoreRows && !showAllRows
                ? '<button class="btn btn-secondary btn-show-all" id="showAllRowsBtn" title="Show all ' + totalRowCount + ' rows">Show All (' + totalRowCount + ')</button>'
                : '';
            
            const collapseButton = showAllRows && hasMoreRows
                ? '<button class="btn btn-secondary btn-show-all" id="collapseRowsBtn" title="Show preview only">Collapse</button>'
                : '';
            
            let html = '<div class="csv-preview">';
            html += '<div class="preview-header">';
            html += '<h5 class="preview-title">' + titleText + '</h5>';
            html += showAllButton + collapseButton;
            html += '</div>';
            html += '<div class="table-container' + (showAllRows ? ' table-container-expanded' : '') + '"><table class="preview-table">';
            html += '<thead><tr>';
            headers.forEach(h => { html += '<th>' + escapeHtml(h) + '</th>'; });
            html += '</tr></thead><tbody>';
            displayItems.forEach(row => {
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

        // Generate flow button handlers
        document.getElementById('generateBtn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'generate' });
        });

        document.getElementById('regenerateBtn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'regenerate' });
        });

        document.getElementById('cancelGenerateBtn')?.addEventListener('click', () => {
            vscode.postMessage({ type: 'cancelGenerate' });
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

        // Attach handlers for review table
        function attachReviewTableHandlers() {
            // Add row button
            document.getElementById('addRowBtn')?.addEventListener('click', () => {
                vscode.postMessage({ type: 'addRow' });
            });

            // Delete selected button
            document.getElementById('deleteSelectedBtn')?.addEventListener('click', () => {
                const checkboxes = document.querySelectorAll('.row-checkbox:checked');
                const indices = Array.from(checkboxes).map(cb => parseInt(cb.getAttribute('data-index'), 10));
                if (indices.length > 0) {
                    vscode.postMessage({ type: 'deleteRows', payload: { indices } });
                }
            });

            // Select all checkbox (header)
            document.getElementById('selectAllCheckbox')?.addEventListener('change', (e) => {
                const selected = e.target.checked;
                vscode.postMessage({ type: 'toggleAll', payload: { selected } });
                // Update local checkboxes immediately
                document.querySelectorAll('.row-checkbox').forEach(cb => {
                    cb.checked = selected;
                });
                updateSelectedCount();
            });

            // Select all checkbox (footer)
            document.getElementById('selectAllFooter')?.addEventListener('change', (e) => {
                const selected = e.target.checked;
                vscode.postMessage({ type: 'toggleAll', payload: { selected } });
                // Update local checkboxes immediately
                document.querySelectorAll('.row-checkbox').forEach(cb => {
                    cb.checked = selected;
                });
                document.getElementById('selectAllCheckbox').checked = selected;
                updateSelectedCount();
            });

            // Individual row checkboxes
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const index = parseInt(e.target.getAttribute('data-index'), 10);
                    const selected = e.target.checked;
                    vscode.postMessage({ type: 'toggleRow', payload: { index, selected } });
                    updateSelectedCount();
                });
            });

            // Cell input changes
            document.querySelectorAll('.cell-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const index = parseInt(e.target.getAttribute('data-index'), 10);
                    const field = e.target.getAttribute('data-field');
                    const value = e.target.value;
                    vscode.postMessage({ type: 'updateCell', payload: { index, field, value } });
                });
            });

            // Cancel review button
            document.getElementById('cancelReviewBtn')?.addEventListener('click', () => {
                vscode.postMessage({ type: 'cancelGenerate' });
            });

            // Run pipeline button
            document.getElementById('runPipelineBtn')?.addEventListener('click', () => {
                const items = collectSelectedItems();
                vscode.postMessage({ type: 'runWithItems', payload: { items } });
            });
        }

        // Update selected count in footer
        function updateSelectedCount() {
            const total = document.querySelectorAll('.row-checkbox').length;
            const selected = document.querySelectorAll('.row-checkbox:checked').length;
            
            const label = document.querySelector('.select-all-label');
            if (label) {
                const checkbox = label.querySelector('input[type="checkbox"]');
                const text = 'Select All (' + selected + '/' + total + ' selected)';
                label.innerHTML = '';
                if (checkbox) label.appendChild(checkbox);
                label.appendChild(document.createTextNode(text));
            }

            const runBtn = document.getElementById('runPipelineBtn');
            if (runBtn) {
                runBtn.disabled = selected === 0;
                runBtn.textContent = '▶️ Run Pipeline (' + selected + ' items)';
            }

            // Update header checkbox
            const headerCheckbox = document.getElementById('selectAllCheckbox');
            if (headerCheckbox) {
                headerCheckbox.checked = selected === total && total > 0;
            }
        }

        // Collect selected items from the table
        function collectSelectedItems() {
            const items = [];
            const config = pipelineData?.config;
            const schema = config?.input?.generate?.schema || [];
            
            document.querySelectorAll('.review-table tbody tr').forEach((row, idx) => {
                const checkbox = row.querySelector('.row-checkbox');
                if (checkbox && checkbox.checked) {
                    const item = {};
                    schema.forEach(field => {
                        const input = row.querySelector('.cell-input[data-field="' + field + '"]');
                        item[field] = input ? input.value : '';
                    });
                    items.push(item);
                }
            });
            
            return items;
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateGenerateState') {
                // Update the local pipelineData with new generate state
                if (pipelineData) {
                    pipelineData.generateState = message.payload?.generateState || null;
                    pipelineData.generatedItems = message.payload?.generatedItems || null;
                }
            } else if (message.type === 'updateShowAllRows') {
                // Update showAllRows state and re-render input details
                if (pipelineData) {
                    pipelineData.showAllRows = message.payload?.showAllRows || false;
                    // Re-render the details content to reflect the new state
                    const detailsContent = document.getElementById('detailsContent');
                    if (detailsContent) {
                        const config = pipelineData.config;
                        const csvInfo = pipelineData.csvInfo;
                        const csvPreview = pipelineData.csvPreview;
                        const csvAllItems = pipelineData.csvAllItems;
                        const showAllRows = pipelineData.showAllRows;
                        const html = generateInputDetails(config, csvInfo, csvPreview, csvAllItems, showAllRows);
                        detailsContent.innerHTML = html;
                        attachFileClickHandlers();
                        attachShowAllRowsHandlers();
                    }
                }
            }
        });

        // Attach handlers for show all rows / collapse buttons
        function attachShowAllRowsHandlers() {
            document.getElementById('showAllRowsBtn')?.addEventListener('click', () => {
                vscode.postMessage({ type: 'toggleShowAllRows', payload: { showAllRows: true } });
            });

            document.getElementById('collapseRowsBtn')?.addEventListener('click', () => {
                vscode.postMessage({ type: 'toggleShowAllRows', payload: { showAllRows: false } });
            });
        }

        // Zoom/Pan state
        const zoomState = {
            scale: 1,
            translateX: 0,
            translateY: 0,
            isDragging: false,
            dragStartX: 0,
            dragStartY: 0,
            lastTranslateX: 0,
            lastTranslateY: 0
        };

        const MIN_ZOOM = 0.25;
        const MAX_ZOOM = 4;
        const ZOOM_STEP = 0.25;

        // Apply transform to diagram
        function applyDiagramTransform() {
            const wrapper = document.getElementById('diagramWrapper');
            const zoomDisplay = document.getElementById('zoomLevel');
            
            if (wrapper) {
                wrapper.style.transform = 'translate(' + zoomState.translateX + 'px, ' + zoomState.translateY + 'px) scale(' + zoomState.scale + ')';
            }
            
            if (zoomDisplay) {
                zoomDisplay.textContent = Math.round(zoomState.scale * 100) + '%';
            }
        }

        // Zoom in button
        document.getElementById('zoomInBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            zoomState.scale = Math.min(MAX_ZOOM, zoomState.scale + ZOOM_STEP);
            applyDiagramTransform();
        });

        // Zoom out button
        document.getElementById('zoomOutBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            zoomState.scale = Math.max(MIN_ZOOM, zoomState.scale - ZOOM_STEP);
            applyDiagramTransform();
        });

        // Reset zoom button
        document.getElementById('zoomResetBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            zoomState.scale = 1;
            zoomState.translateX = 0;
            zoomState.translateY = 0;
            applyDiagramTransform();
        });

        // Mouse wheel zoom
        const diagramContainer = document.getElementById('diagramContainer');
        if (diagramContainer) {
            diagramContainer.addEventListener('wheel', (e) => {
                // Only zoom if Ctrl/Cmd is held
                if (!e.ctrlKey && !e.metaKey) return;

                e.preventDefault();
                e.stopPropagation();

                const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomState.scale + delta));

                // Zoom towards mouse position
                if (newScale !== zoomState.scale) {
                    const rect = diagramContainer.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;
                    const mouseY = e.clientY - rect.top;

                    // Calculate the point under the mouse in diagram coordinates
                    const pointX = (mouseX - zoomState.translateX) / zoomState.scale;
                    const pointY = (mouseY - zoomState.translateY) / zoomState.scale;

                    zoomState.scale = newScale;

                    // Adjust translation to keep the point under the mouse
                    zoomState.translateX = mouseX - pointX * zoomState.scale;
                    zoomState.translateY = mouseY - pointY * zoomState.scale;

                    applyDiagramTransform();
                }
            }, { passive: false });

            // Mouse drag for panning
            diagramContainer.addEventListener('mousedown', (e) => {
                // Only pan with left click when not clicking on a node
                const target = e.target;
                const isNode = target.closest('.node, .cluster, .label');

                if (e.button === 0 && !isNode) {
                    zoomState.isDragging = true;
                    zoomState.dragStartX = e.clientX;
                    zoomState.dragStartY = e.clientY;
                    zoomState.lastTranslateX = zoomState.translateX;
                    zoomState.lastTranslateY = zoomState.translateY;
                    diagramContainer.classList.add('dragging');
                    
                    // Disable transition during drag for smooth movement
                    const wrapper = document.getElementById('diagramWrapper');
                    if (wrapper) wrapper.classList.add('no-transition');
                    
                    e.preventDefault();
                }
            });

            diagramContainer.addEventListener('mousemove', (e) => {
                if (!zoomState.isDragging) return;

                const deltaX = e.clientX - zoomState.dragStartX;
                const deltaY = e.clientY - zoomState.dragStartY;

                zoomState.translateX = zoomState.lastTranslateX + deltaX;
                zoomState.translateY = zoomState.lastTranslateY + deltaY;

                applyDiagramTransform();
            });

            const stopDragging = () => {
                if (zoomState.isDragging) {
                    zoomState.isDragging = false;
                    diagramContainer.classList.remove('dragging');
                    
                    // Re-enable transition
                    const wrapper = document.getElementById('diagramWrapper');
                    if (wrapper) wrapper.classList.remove('no-transition');
                }
            };

            diagramContainer.addEventListener('mouseup', stopDragging);
            diagramContainer.addEventListener('mouseleave', stopDragging);
        }

        // Initial setup
        attachFileClickHandlers();
        attachReviewTableHandlers();
        attachShowAllRowsHandlers();
        
        // Notify extension that webview is ready
        vscode.postMessage({ type: 'ready' });
    `;
}

/**
 * Escape HTML special characters
 * Uses the shared WebviewSetupHelper utility
 */
function escapeHtml(text: string): string {
    return WebviewSetupHelper.escapeHtml(text);
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
