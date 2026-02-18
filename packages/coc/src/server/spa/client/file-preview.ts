/**
 * File Path Preview — hover tooltip + click-to-dialog for file paths in chat messages.
 *
 * Uses event delegation on document.body so no re-attachment is needed for
 * dynamically rendered content (SSE streaming, conversation load, etc.).
 */

import { escapeHtmlClient, copyToClipboard } from './utils';
import { shortenPath } from './tool-renderer';
import { getApiBase } from './config';
import { appState } from './state';

// ============================================================================
// Types
// ============================================================================

interface FilePreviewResponse {
    path: string;
    fileName: string;
    lines: string[];
    totalLines: number;
    truncated: boolean;
    language: string;
}

interface PreviewCacheEntry {
    data: FilePreviewResponse | null;
    error: string | null;
    timestamp: number;
}

// ============================================================================
// Cache
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 50;
const previewCache = new Map<string, PreviewCacheEntry>();

function getCacheKey(fullPath: string, lines: number): string {
    return `${fullPath}::${lines}`;
}

function getCached(key: string): PreviewCacheEntry | null {
    const entry = previewCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        previewCache.delete(key);
        return null;
    }
    return entry;
}

function setCache(key: string, data: FilePreviewResponse | null, error: string | null): void {
    // Evict oldest entries if at capacity
    if (previewCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = previewCache.keys().next().value;
        if (oldest) previewCache.delete(oldest);
    }
    previewCache.set(key, { data, error, timestamp: Date.now() });
}

// ============================================================================
// Workspace resolution
// ============================================================================

function getWorkspaceForPath(filePath: string): { id: string } | null {
    // Find workspace whose rootPath is a prefix of the file path
    for (const ws of appState.workspaces) {
        if (ws.rootPath && filePath.startsWith(ws.rootPath)) {
            return ws;
        }
    }
    // Fallback to first workspace
    if (appState.workspaces.length > 0) {
        return appState.workspaces[0];
    }
    return null;
}

// ============================================================================
// API fetch
// ============================================================================

async function fetchFilePreview(fullPath: string, lines: number): Promise<FilePreviewResponse> {
    const ws = getWorkspaceForPath(fullPath);
    if (!ws) throw new Error('No workspace available');

    const params = new URLSearchParams({ path: fullPath });
    if (lines !== 20) params.set('lines', String(lines));

    const url = `${getApiBase()}/workspaces/${encodeURIComponent(ws.id)}/files/preview?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
    }
    return await res.json();
}

// ============================================================================
// Hover Tooltip
// ============================================================================

let tooltipEl: HTMLDivElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let currentTarget: HTMLElement | null = null;

function createTooltipElement(): HTMLDivElement {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'file-preview-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);

    // Keep tooltip open when mouse moves onto it
    tooltipEl.addEventListener('mouseenter', () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    tooltipEl.addEventListener('mouseleave', () => {
        scheduleHide();
    });

    return tooltipEl;
}

function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        hideTooltip();
    }, 200);
}

function hideTooltip(): void {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const tip = tooltipEl;
    if (tip) tip.style.display = 'none';
    currentTarget = null;
}

function positionTooltip(target: HTMLElement): void {
    const tip = createTooltipElement();
    const rect = target.getBoundingClientRect();
    const tipWidth = 500;
    const tipMaxHeight = 350;

    let left = rect.left;
    let top = rect.bottom + 6;

    // Viewport-aware: if overflows right, shift left
    if (left + tipWidth > window.innerWidth - 16) {
        left = window.innerWidth - tipWidth - 16;
    }
    if (left < 8) left = 8;

    // If overflows bottom, show above
    if (top + tipMaxHeight > window.innerHeight - 16) {
        top = rect.top - tipMaxHeight - 6;
        if (top < 8) top = 8;
    }

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
}

async function showTooltip(target: HTMLElement): Promise<void> {
    const fullPath = target.getAttribute('data-full-path') || '';
    if (!fullPath) return;

    currentTarget = target;
    const tip = createTooltipElement();

    // Show loading state
    const fileName = fullPath.split('/').pop() || fullPath;
    tip.innerHTML =
        '<div class="file-preview-tooltip-header">' + escapeHtmlClient(fileName) + '</div>' +
        '<div class="file-preview-tooltip-body file-preview-tooltip-loading">Loading…</div>';
    tip.style.display = 'block';
    positionTooltip(target);

    // Check cache
    const cacheKey = getCacheKey(fullPath, 20);
    const cached = getCached(cacheKey);
    if (cached) {
        if (currentTarget !== target) return; // Mouse moved away
        if (cached.error) {
            renderTooltipError(cached.error);
        } else if (cached.data) {
            renderTooltipContent(cached.data);
        }
        return;
    }

    // Fetch
    try {
        const data = await fetchFilePreview(fullPath, 20);
        setCache(cacheKey, data, null);
        if (currentTarget !== target) return;
        renderTooltipContent(data);
    } catch (err: any) {
        const msg = err.message || 'Failed to load preview';
        setCache(cacheKey, null, msg);
        if (currentTarget !== target) return;
        renderTooltipError(msg);
    }
}

function renderTooltipContent(data: FilePreviewResponse): void {
    const tip = tooltipEl;
    if (!tip) return;

    const lineNums = data.lines.map((_, i) => '<span class="line-number">' + (i + 1) + '</span>').join('\n');
    const code = data.lines.map(l => escapeHtmlClient(l)).join('\n');
    const info = data.truncated ? ' (' + data.totalLines + ' total)' : '';

    tip.innerHTML =
        '<div class="file-preview-tooltip-header">' +
            '<span class="file-preview-tooltip-filename">' + escapeHtmlClient(data.fileName) + '</span>' +
            '<span class="file-preview-tooltip-info">' + data.lines.length + ' lines' + escapeHtmlClient(info) + '</span>' +
        '</div>' +
        '<div class="file-preview-tooltip-body">' +
            '<pre class="file-preview-code"><code class="line-numbers">' + lineNums + '</code><code class="line-content">' + code + '</code></pre>' +
        '</div>';
}

function renderTooltipError(msg: string): void {
    const tip = tooltipEl;
    if (!tip) return;

    tip.innerHTML =
        '<div class="file-preview-tooltip-header">Preview Error</div>' +
        '<div class="file-preview-tooltip-body file-preview-tooltip-error">' + escapeHtmlClient(msg) + '</div>';
}

// ============================================================================
// Click → Full Content Dialog (Modal)
// ============================================================================

function showFileDialog(fullPath: string): void {
    // Remove existing dialog
    const existing = document.querySelector('.file-content-overlay');
    if (existing) existing.remove();

    const fileName = fullPath.split('/').pop() || fullPath;
    const short = shortenPath(fullPath);

    // Build overlay
    const overlay = document.createElement('div');
    overlay.className = 'file-content-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'file-content-dialog';

    // Header
    dialog.innerHTML =
        '<div class="file-content-dialog-header">' +
            '<div class="file-content-dialog-title">' +
                '<span class="file-content-dialog-filename">' + escapeHtmlClient(short) + '</span>' +
                '<span class="file-content-dialog-fullpath">' + escapeHtmlClient(fullPath) + '</span>' +
            '</div>' +
            '<div class="file-content-dialog-actions">' +
                '<button class="file-content-dialog-copy" title="Copy path">📋</button>' +
                '<button class="file-content-dialog-close" title="Close">✕</button>' +
            '</div>' +
        '</div>' +
        '<div class="file-content-dialog-body">' +
            '<div class="file-preview-tooltip-loading">Loading…</div>' +
        '</div>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Close handlers
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    dialog.querySelector('.file-content-dialog-close')!.addEventListener('click', close);
    dialog.querySelector('.file-content-dialog-copy')!.addEventListener('click', () => {
        copyToClipboard(fullPath);
    });

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKeyDown); }
    };
    document.addEventListener('keydown', onKeyDown);

    // Fetch full content (lines=0 means all)
    const cacheKey = getCacheKey(fullPath, 0);
    const cached = getCached(cacheKey);

    const renderBody = (data: FilePreviewResponse) => {
        const body = dialog.querySelector('.file-content-dialog-body')!;
        const lineNums = data.lines.map((_, i) => '<span class="line-number">' + (i + 1) + '</span>').join('\n');
        const code = data.lines.map(l => escapeHtmlClient(l)).join('\n');
        body.innerHTML =
            '<pre class="file-preview-code"><code class="line-numbers">' + lineNums + '</code><code class="line-content">' + code + '</code></pre>';
    };

    const renderError = (msg: string) => {
        const body = dialog.querySelector('.file-content-dialog-body')!;
        body.innerHTML = '<div class="file-preview-tooltip-error">' + escapeHtmlClient(msg) + '</div>';
    };

    if (cached) {
        if (cached.error) renderError(cached.error);
        else if (cached.data) renderBody(cached.data);
        return;
    }

    fetchFilePreview(fullPath, 0).then(data => {
        setCache(cacheKey, data, null);
        renderBody(data);
    }).catch((err: any) => {
        const msg = err.message || 'Failed to load file';
        setCache(cacheKey, null, msg);
        renderError(msg);
    });
}

// ============================================================================
// Event Delegation
// ============================================================================

function findFilePathLink(el: EventTarget | null): HTMLElement | null {
    if (!el || !(el instanceof HTMLElement)) return null;
    if (el.classList.contains('file-path-link')) return el;
    // Walk up a couple levels for clicks on nested spans
    const parent = el.closest('.file-path-link');
    return parent as HTMLElement | null;
}

// Hover: mouseenter/mouseleave via delegation
document.body.addEventListener('mouseover', (e: MouseEvent) => {
    const target = findFilePathLink(e.target);
    if (!target) return;

    // Cancel any pending hide
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

    // Don't re-trigger if already showing for this target
    if (currentTarget === target) return;

    // Cancel previous hover timer
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }

    hoverTimer = setTimeout(() => {
        showTooltip(target);
    }, 300);
});

document.body.addEventListener('mouseout', (e: MouseEvent) => {
    const target = findFilePathLink(e.target);
    if (!target) return;

    // Cancel pending show
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }

    // Schedule hide (gives user time to move to tooltip)
    scheduleHide();
});

// Click: open full content dialog
document.body.addEventListener('click', (e: MouseEvent) => {
    const target = findFilePathLink(e.target);
    if (!target) return;

    e.preventDefault();
    e.stopPropagation();

    // Hide tooltip
    hideTooltip();

    const fullPath = target.getAttribute('data-full-path') || '';
    if (fullPath) showFileDialog(fullPath);
});
