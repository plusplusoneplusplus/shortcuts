/**
 * File path hover preview and click-to-open dialog for the webview.
 *
 * Adds two interactive behaviors for `.file-path-link` spans:
 * 1. Hover → tooltip with file content preview (first ~50 lines)
 * 2. Click → modal dialog with full content (up to 500 lines)
 *
 * Uses postMessage round-trip (readFilePreview / filePreviewResult) to fetch
 * file content from the extension host.
 */

import { openFile, requestFilePreview, requestUpdateDocument, requestRefreshPlan, requestChatInCLI, requestPromptSearch } from './vscode-bridge';
import { setPreviewActionFilePath } from './preview-action-state';
import { applyMarkdownHighlighting } from '../webview-logic/markdown-renderer';
import type { ExtensionMessage } from './types';

// --- Constants ---

const HOVER_DELAY_MS = 250;
const HIDE_DELAY_MS = 200;
const CACHE_MAX_ENTRIES = 30;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// --- Types ---

interface CacheEntry {
    content?: string;
    language: string;
    lineCount: number;
    error?: string;
    timestamp: number;
}

interface PendingRequest {
    resolve: (entry: CacheEntry) => void;
}

// --- Module state ---

let tooltipEl: HTMLDivElement | null = null;
let dialogEl: HTMLDivElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let activeRequestId = 0;
let currentHoverTarget: HTMLElement | null = null;
/** Current view mode for the dialog (only relevant for .md files) */
let dialogViewMode: 'preview' | 'source' = 'preview';
/** File path currently shown in the dialog */
let dialogCurrentPath: string = '';

const cache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, PendingRequest>();

// --- Cache ---

function getCached(key: string): CacheEntry | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        cache.delete(key);
        return undefined;
    }
    return entry;
}

function setCache(key: string, entry: CacheEntry): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        // Evict oldest entry
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, entry);
}

function makeCacheKey(path: string, full: boolean): string {
    return full ? `full:${path}` : `preview:${path}`;
}

// --- Request / response ---

function generateRequestId(): string {
    return `fp-${++activeRequestId}-${Date.now()}`;
}

async function fetchPreview(filePath: string, full: boolean): Promise<CacheEntry> {
    const cacheKey = makeCacheKey(filePath, full);
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const requestId = generateRequestId();
    return new Promise<CacheEntry>((resolve) => {
        pendingRequests.set(requestId, { resolve });
        requestFilePreview(filePath, requestId, full);

        // Timeout after 5 seconds
        setTimeout(() => {
            if (pendingRequests.has(requestId)) {
                pendingRequests.delete(requestId);
                resolve({ language: '', lineCount: 0, error: 'Request timed out', timestamp: Date.now() });
            }
        }, 5000);
    });
}

/**
 * Handle filePreviewResult messages from the extension host.
 * Called from the main message handler.
 */
export function handleFilePreviewResult(message: ExtensionMessage): void {
    if (message.type !== 'filePreviewResult') return;

    const entry: CacheEntry = {
        content: message.content,
        language: message.language,
        lineCount: message.lineCount,
        error: message.error,
        timestamp: Date.now()
    };

    // Cache the result
    const cacheKey = makeCacheKey(message.path, !!message.full);
    setCache(cacheKey, entry);
    // Also cache as preview if it's a full result
    if (message.full) {
        const previewKey = makeCacheKey(message.path, false);
        setCache(previewKey, entry);
    }

    // Resolve pending request
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
        pendingRequests.delete(message.requestId);
        pending.resolve(entry);
    }
}

// --- Tooltip ---

function getOrCreateTooltip(): HTMLDivElement {
    if (!tooltipEl) {
        tooltipEl = document.getElementById('filePreviewTooltip') as HTMLDivElement;
    }
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'file-preview-tooltip';
        tooltipEl.id = 'filePreviewTooltip';
        tooltipEl.style.display = 'none';
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

function positionTooltip(tooltip: HTMLDivElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    tooltip.style.display = 'block';

    const tipRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.left;

    // Flip above if not enough space below
    if (top + tipRect.height > window.innerHeight - 10) {
        top = rect.top - tipRect.height - 4;
    }
    // Clamp right edge
    if (left + tipRect.width > window.innerWidth - 10) {
        left = window.innerWidth - tipRect.width - 10;
    }
    // Clamp left
    if (left < 10) left = 10;

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
}

function renderTooltipLoading(tooltip: HTMLDivElement, fileName: string): void {
    tooltip.innerHTML = `
        <div class="file-preview-header">${escapeHtml(fileName)}</div>
        <div class="file-preview-body file-preview-loading">Loading preview…</div>
    `;
}

function renderTooltipContent(tooltip: HTMLDivElement, fileName: string, entry: CacheEntry): void {
    if (entry.error) {
        tooltip.innerHTML = `
            <div class="file-preview-header">${escapeHtml(fileName)}</div>
            <div class="file-preview-body file-preview-error">${escapeHtml(entry.error)}</div>
        `;
        return;
    }

    const lines = (entry.content || '').split('\n');
    const displayLines = lines.slice(0, 50);
    const numbered = displayLines.map((line, i) =>
        `<span class="file-preview-line-num">${i + 1}</span>${escapeHtml(line)}`
    ).join('\n');

    const truncated = entry.lineCount > 50 ? `<div class="file-preview-truncated">${entry.lineCount} lines total</div>` : '';

    let highlighted = numbered;
    if (entry.language && typeof hljs !== 'undefined') {
        try {
            const raw = displayLines.join('\n');
            const result = hljs.getLanguage(entry.language)
                ? hljs.highlight(raw, { language: entry.language })
                : hljs.highlightAuto(raw);
            // Re-add line numbers to highlighted output
            const hlLines = result.value.split('\n');
            highlighted = hlLines.map((line, i) =>
                `<span class="file-preview-line-num">${i + 1}</span>${line}`
            ).join('\n');
        } catch {
            // Fall back to non-highlighted
        }
    }

    tooltip.innerHTML = `
        <div class="file-preview-header">${escapeHtml(fileName)}</div>
        <pre class="file-preview-body"><code>${highlighted}</code></pre>
        ${truncated}
        <div class="file-preview-footer">Click to preview • Ctrl+Click to open in editor</div>
    `;
}

async function showTooltip(target: HTMLElement): Promise<void> {
    const fullPath = target.getAttribute('data-full-path');
    if (!fullPath) return;

    const tooltip = getOrCreateTooltip();
    const fileName = fullPath.split('/').pop() || fullPath;

    renderTooltipLoading(tooltip, fileName);
    positionTooltip(tooltip, target);

    const entry = await fetchPreview(fullPath, false);

    // Check race condition: if user moved to another target, don't render
    if (currentHoverTarget !== target) return;

    renderTooltipContent(tooltip, fileName, entry);
    positionTooltip(tooltip, target);
}

function hideTooltip(): void {
    const tooltip = getOrCreateTooltip();
    tooltip.style.display = 'none';
    currentHoverTarget = null;
}

function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        hideTooltip();
        hideTimer = null;
    }, HIDE_DELAY_MS);
}

function cancelHide(): void {
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
}

// --- Dialog ---

function getOrCreateDialog(): HTMLDivElement {
    if (!dialogEl) {
        dialogEl = document.getElementById('filePreviewDialog') as HTMLDivElement;
    }
    if (!dialogEl) {
        dialogEl = document.createElement('div');
        dialogEl.className = 'modal-overlay';
        dialogEl.id = 'filePreviewDialog';
        dialogEl.style.display = 'none';
        document.body.appendChild(dialogEl);
    }
    return dialogEl;
}

function renderDialogLoading(dialog: HTMLDivElement, filePath: string): void {
    const fileName = filePath.split('/').pop() || filePath;
    dialog.innerHTML = `
        <div class="modal-dialog file-preview-dialog">
            <div class="modal-header">
                <h3>📄 ${escapeHtml(fileName)}</h3>
                <button class="modal-close-btn file-preview-dialog-close">×</button>
            </div>
            <div class="modal-body">
                <div class="file-preview-dialog-path">${escapeHtml(filePath)}</div>
                <div class="file-preview-loading">Loading file content…</div>
            </div>
        </div>
    `;
    dialog.style.display = 'flex';
    setupDialogCloseHandlers(dialog, filePath);
}

/**
 * Render markdown content using the same line-by-line highlighting used in the main editor.
 * Returns an HTML string with `.line-row` / `.line-content` structure.
 */
function renderMarkdownPreview(content: string): string {
    const lines = content.split('\n');
    let html = '';
    let inCodeBlock = false;
    let codeBlockLang: string | null = null;

    lines.forEach((line, index) => {
        const lineNum = index + 1;
        let lineHtml: string;
        if (line.length === 0) {
            lineHtml = '<br>';
        } else {
            const result = applyMarkdownHighlighting(line, lineNum, inCodeBlock, codeBlockLang);
            lineHtml = result.html;
            inCodeBlock = result.inCodeBlock;
            codeBlockLang = result.codeBlockLang;
        }
        html += `<div class="line-row">` +
            `<div class="line-number">${lineNum}</div>` +
            `<div class="line-content" data-line="${lineNum}">${lineHtml}</div>` +
            `</div>`;
    });

    return html;
}

/**
 * Build the AI action dropdown HTML (shown for .md files only).
 */
function buildAIActionDropdownHtml(): string {
    return `<div class="file-preview-ai-dropdown" id="filePreviewAIDropdown">
        <button class="btn btn-secondary file-preview-ai-btn" id="filePreviewAIBtn">🤖 AI Action ▼</button>
        <div class="file-preview-ai-menu" id="filePreviewAIMenu" style="display:none;">
            <div class="file-preview-ai-item" data-action="follow-prompt">🚀 Follow Prompt</div>
            <div class="file-preview-ai-item" data-action="update-doc">📝 Update Document</div>
            <div class="file-preview-ai-item" data-action="refresh-plan">🔄 Refresh Plan</div>
            <div class="file-preview-ai-item" data-action="chat-in-cli">💬 Chat In CLI</div>
        </div>
    </div>`;
}

/**
 * Build the mode toggle HTML for .md files (Preview / Source).
 */
function buildModeToggleHtml(currentMode: 'preview' | 'source'): string {
    const previewActive = currentMode === 'preview' ? ' active' : '';
    const sourceActive = currentMode === 'source' ? ' active' : '';
    return `<div class="file-preview-mode-toggle">` +
        `<button class="file-preview-mode-btn${previewActive}" data-mode="preview">Preview</button>` +
        `<button class="file-preview-mode-btn${sourceActive}" data-mode="source">Source</button>` +
        `</div>`;
}

function renderDialogContent(dialog: HTMLDivElement, filePath: string, entry: CacheEntry): void {
    const fileName = filePath.split('/').pop() || filePath;
    const isMarkdown = /\.md$/i.test(filePath);

    if (entry.error) {
        dialog.innerHTML = `
            <div class="modal-dialog file-preview-dialog">
                <div class="modal-header">
                    <h3>📄 ${escapeHtml(fileName)}</h3>
                    <button class="modal-close-btn file-preview-dialog-close">×</button>
                </div>
                <div class="modal-body">
                    <div class="file-preview-dialog-path">${escapeHtml(filePath)}</div>
                    <div class="file-preview-error">${escapeHtml(entry.error)}</div>
                </div>
            </div>
        `;
        dialog.style.display = 'flex';
        setupDialogCloseHandlers(dialog, filePath);
        return;
    }

    const lines = (entry.content || '').split('\n');
    const displayLines = lines.slice(0, 500);
    const truncated = entry.lineCount > 500
        ? `<div class="file-preview-truncated">Showing 500 of ${entry.lineCount} lines. Open in editor to see full file.</div>`
        : '';

    // Build body content based on view mode
    let bodyContent: string;
    if (isMarkdown && dialogViewMode === 'preview') {
        const renderedContent = renderMarkdownPreview(displayLines.join('\n'));
        bodyContent = `<div class="file-preview-dialog-rendered editor-wrapper">${renderedContent}</div>`;
    } else {
        // Source mode: syntax-highlighted code
        let bodyHtml: string;
        if (entry.language && typeof hljs !== 'undefined') {
            try {
                const raw = displayLines.join('\n');
                const result = hljs.getLanguage(entry.language)
                    ? hljs.highlight(raw, { language: entry.language })
                    : hljs.highlightAuto(raw);
                const hlLines = result.value.split('\n');
                bodyHtml = hlLines.map((line, i) =>
                    `<span class="file-preview-line-num">${i + 1}</span>${line}`
                ).join('\n');
            } catch {
                bodyHtml = displayLines.map((line, i) =>
                    `<span class="file-preview-line-num">${i + 1}</span>${escapeHtml(line)}`
                ).join('\n');
            }
        } else {
            bodyHtml = displayLines.map((line, i) =>
                `<span class="file-preview-line-num">${i + 1}</span>${escapeHtml(line)}`
            ).join('\n');
        }
        bodyContent = `<pre class="file-preview-dialog-code"><code>${bodyHtml}</code></pre>`;
    }

    const modeToggle = isMarkdown ? buildModeToggleHtml(dialogViewMode) : '';
    const aiActionDropdown = isMarkdown ? buildAIActionDropdownHtml() : '';

    dialog.innerHTML = `
        <div class="modal-dialog file-preview-dialog">
            <div class="modal-header">
                <h3>📄 ${escapeHtml(fileName)}</h3>
                ${modeToggle}
                <button class="modal-close-btn file-preview-dialog-close">×</button>
            </div>
            <div class="modal-body">
                <div class="file-preview-dialog-path">${escapeHtml(filePath)}</div>
                ${bodyContent}
                ${truncated}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary file-preview-dialog-close">Close</button>
                ${aiActionDropdown}
                <button class="btn btn-primary file-preview-dialog-open">Open in Editor</button>
            </div>
        </div>
    `;
    dialog.style.display = 'flex';
    setupDialogCloseHandlers(dialog, filePath);
}

function setupDialogCloseHandlers(dialog: HTMLDivElement, filePath: string): void {
    // Close buttons
    dialog.querySelectorAll('.file-preview-dialog-close').forEach(btn => {
        btn.addEventListener('click', () => closeDialog());
    });

    // Open in editor
    dialog.querySelectorAll('.file-preview-dialog-open').forEach(btn => {
        btn.addEventListener('click', () => {
            openFile(filePath);
            closeDialog();
        });
    });

    // Preview / Source mode toggle (for .md files)
    dialog.querySelectorAll('.file-preview-mode-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = (btn as HTMLElement).getAttribute('data-mode') as 'preview' | 'source';
            if (mode && mode !== dialogViewMode) {
                dialogViewMode = mode;
                // Re-fetch and re-render with new mode (content is already cached)
                const entry = await fetchPreview(filePath, true);
                renderDialogContent(dialog, filePath, entry);
            }
        });
    });

    // AI Action dropdown toggle
    const aiBtn = dialog.querySelector('#filePreviewAIBtn');
    const aiMenu = dialog.querySelector('#filePreviewAIMenu') as HTMLElement | null;
    if (aiBtn && aiMenu) {
        aiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = aiMenu.style.display !== 'none';
            aiMenu.style.display = isVisible ? 'none' : 'block';
        });

        // Close menu when clicking outside
        document.addEventListener('click', () => {
            aiMenu.style.display = 'none';
        }, { once: false, capture: true });
    }

    // AI action items
    dialog.querySelectorAll('.file-preview-ai-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = (item as HTMLElement).getAttribute('data-action');
            setPreviewActionFilePath(filePath);
            closeDialog();

            switch (action) {
                case 'follow-prompt':
                    requestPromptSearch(filePath);
                    break;
                case 'update-doc':
                    requestUpdateDocument();
                    break;
                case 'refresh-plan':
                    requestRefreshPlan();
                    break;
                case 'chat-in-cli':
                    requestChatInCLI(filePath);
                    break;
            }
        });
    });

    // Click outside to close
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog();
    });
}

function closeDialog(): void {
    const dialog = getOrCreateDialog();
    dialog.style.display = 'none';
    dialog.innerHTML = '';
    dialogCurrentPath = '';
}

async function showDialog(filePath: string): Promise<void> {
    const isMarkdown = /\.md$/i.test(filePath);
    // Default to preview mode for markdown files
    if (isMarkdown && dialogCurrentPath !== filePath) {
        dialogViewMode = 'preview';
    }
    dialogCurrentPath = filePath;

    const dialog = getOrCreateDialog();
    renderDialogLoading(dialog, filePath);

    const entry = await fetchPreview(filePath, true);
    renderDialogContent(dialog, filePath, entry);
}

// --- Escape key handler ---

function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
        const dialog = document.getElementById('filePreviewDialog');
        if (dialog && dialog.style.display !== 'none') {
            closeDialog();
            e.preventDefault();
            e.stopPropagation();
        }
    }
}

// --- Utility ---

function escapeHtml(text: string): string {
    const div = document.createElement('span');
    div.textContent = text;
    return div.innerHTML;
}

function findFilePathLink(target: EventTarget | null): HTMLElement | null {
    if (!target || !(target instanceof HTMLElement)) return null;
    return target.closest('.file-path-link') as HTMLElement | null;
}

// --- Initialization ---

function isMobile(): boolean {
    return (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
        /Mobi|Android|iPhone|iPad|Touch/i.test(navigator.userAgent);
}

/**
 * Initialize file path preview handlers.
 * Sets up event delegation on document.body for hover and click on `.file-path-link` spans.
 */
export function initFilePathPreview(): void {
    if (!isMobile()) {
        // Hover: mouseover with delay
        document.body.addEventListener('mouseover', (e) => {
            const target = findFilePathLink(e.target);
            if (!target) return;
            if (target.hasAttribute('data-no-preview-hover')) return;

            cancelHide();
            if (hoverTimer) clearTimeout(hoverTimer);

            currentHoverTarget = target;
            hoverTimer = setTimeout(() => {
                showTooltip(target);
                hoverTimer = null;
            }, HOVER_DELAY_MS);
        });

        // Hover: mouseout — schedule hide
        document.body.addEventListener('mouseout', (e) => {
            const target = findFilePathLink(e.target);
            if (!target) return;

            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }
            scheduleHide();
        });

        // Keep tooltip visible when mouse enters it
        const tooltip = getOrCreateTooltip();
        tooltip.addEventListener('mouseenter', () => cancelHide());
        tooltip.addEventListener('mouseleave', () => scheduleHide());
    }

    // Click: open dialog or open in editor
    document.body.addEventListener('click', (e) => {
        const target = findFilePathLink(e.target);
        if (!target) return;

        const fullPath = target.getAttribute('data-full-path');
        if (!fullPath) return;

        e.preventDefault();
        e.stopPropagation();
        hideTooltip();

        const mouseEvent = e as MouseEvent;
        if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
            // Ctrl+Click → open directly in editor
            openFile(fullPath);
        } else {
            // Regular click → show preview dialog
            showDialog(fullPath);
        }
    });

    // Hide tooltip on scroll
    document.addEventListener('scroll', () => {
        hideTooltip();
    }, true);

    // Escape key to close dialog
    document.addEventListener('keydown', handleKeyDown);
}
