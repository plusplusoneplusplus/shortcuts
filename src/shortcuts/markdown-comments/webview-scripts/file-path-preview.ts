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

import { openFile, requestFilePreview } from './vscode-bridge';
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

function renderDialogContent(dialog: HTMLDivElement, filePath: string, entry: CacheEntry): void {
    const fileName = filePath.split('/').pop() || filePath;

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

    const truncated = entry.lineCount > 500
        ? `<div class="file-preview-truncated">Showing 500 of ${entry.lineCount} lines. Open in editor to see full file.</div>`
        : '';

    dialog.innerHTML = `
        <div class="modal-dialog file-preview-dialog">
            <div class="modal-header">
                <h3>📄 ${escapeHtml(fileName)}</h3>
                <button class="modal-close-btn file-preview-dialog-close">×</button>
            </div>
            <div class="modal-body">
                <div class="file-preview-dialog-path">${escapeHtml(filePath)}</div>
                <pre class="file-preview-dialog-code"><code>${bodyHtml}</code></pre>
                ${truncated}
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary file-preview-dialog-close">Close</button>
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

    // Click outside to close
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) closeDialog();
    });
}

function closeDialog(): void {
    const dialog = getOrCreateDialog();
    dialog.style.display = 'none';
    dialog.innerHTML = '';
}

async function showDialog(filePath: string): Promise<void> {
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

/**
 * Initialize file path preview handlers.
 * Sets up event delegation on document.body for hover and click on `.file-path-link` spans.
 */
export function initFilePathPreview(): void {
    // Hover: mouseover with delay
    document.body.addEventListener('mouseover', (e) => {
        const target = findFilePathLink(e.target);
        if (!target) return;

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
