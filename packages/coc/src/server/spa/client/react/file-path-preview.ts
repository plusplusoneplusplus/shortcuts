/**
 * File path hover preview for markdown-rendered `.file-path-link` spans.
 *
 * React migration kept file-path markup but dropped the legacy delegated
 * hover handlers. This module restores tooltip previews via global delegation.
 */

import { getApiBase } from './utils/config';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';

interface WorkspaceInfo {
    id: string;
    rootPath?: string;
}

interface FilePreviewResponse {
    type?: 'file';
    path: string;
    fileName: string;
    lines: string[];
    totalLines: number;
    truncated: boolean;
}

interface DirectoryPreviewResponse {
    type: 'directory';
    path: string;
    dirName: string;
    entries: { name: string; isDirectory: boolean }[];
    totalEntries: number;
    truncated: boolean;
}

type PreviewResponse = FilePreviewResponse | DirectoryPreviewResponse;

interface CacheEntry {
    data: PreviewResponse | null;
    error: string | null;
    timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const WORKSPACE_CACHE_TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 50;
const HOVER_DELAY_MS = 250;
const TOOLTIP_GAP_PX = 6;
const TOOLTIP_VIEWPORT_PADDING_PX = 16;
const TOOLTIP_EDGE_MARGIN_PX = 8;
const TOOLTIP_DEFAULT_MAX_WIDTH_PX = 960;
const TOOLTIP_DEFAULT_MAX_HEIGHT_PX = 560;
const TOOLTIP_MIN_USEFUL_HEIGHT_PX = 80;

const previewCache = new Map<string, CacheEntry>();

let tooltipEl: HTMLDivElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let activeTarget: HTMLElement | null = null;
let activeRequestId = 0;
let isScrollingTooltip = false;
let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

let workspacesCache: WorkspaceInfo[] | null = null;
let workspacesFetchedAt = 0;
let workspacesLoading: Promise<WorkspaceInfo[]> | null = null;

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function createTooltip(): HTMLDivElement {
    if (tooltipEl) return tooltipEl;
    const el = document.createElement('div');
    el.className = 'file-preview-tooltip';
    el.style.display = 'none';
    document.body.appendChild(el);

    el.addEventListener('mouseenter', () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    });
    el.addEventListener('mouseleave', (event: MouseEvent) => {
        if (!isScrollingTooltip && event.buttons === 0) scheduleHide();
    });

    // Set flag immediately on mousedown so mouseleave fired before scroll
    // (e.g. when clicking a scrollbar) cannot dismiss the tooltip.
    el.addEventListener('mousedown', () => {
        isScrollingTooltip = true;
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
    });

    // Prevent wheel events from scrolling the underlying page
    el.addEventListener('wheel', (event) => {
        event.stopPropagation();
    }, { passive: true });

    // Track scroll activity so mouseleave during scroll doesn't dismiss
    el.addEventListener('scroll', () => {
        isScrollingTooltip = true;
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
            isScrollingTooltip = false;
            // If mouse already left while scrolling, hide now
            if (tooltipEl && !tooltipEl.matches(':hover')) {
                scheduleHide();
            }
        }, 150);
    }, true);

    tooltipEl = el;
    return el;
}

function getCacheKey(path: string): string {
    return `${path}::20`;
}

function getFromCache(path: string): CacheEntry | null {
    const entry = previewCache.get(getCacheKey(path));
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
        previewCache.delete(getCacheKey(path));
        return null;
    }
    return entry;
}

function setCache(path: string, data: PreviewResponse | null, error: string | null): void {
    if (previewCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = previewCache.keys().next().value;
        if (oldest) previewCache.delete(oldest);
    }
    previewCache.set(getCacheKey(path), { data, error, timestamp: Date.now() });
}

async function fetchWorkspaces(): Promise<WorkspaceInfo[]> {
    if (workspacesCache && Date.now() - workspacesFetchedAt < WORKSPACE_CACHE_TTL_MS) {
        return workspacesCache;
    }
    if (workspacesLoading) return workspacesLoading;

    workspacesLoading = fetch(`${getApiBase()}/workspaces`)
        .then(async (res) => {
            if (!res.ok) return [];
            const body = await res.json().catch(() => null);
            const workspaces = Array.isArray(body) ? body : body?.workspaces;
            if (!Array.isArray(workspaces)) return [];
            return workspaces as WorkspaceInfo[];
        })
        .catch(() => [])
        .finally(() => {
            workspacesLoading = null;
        });

    const workspaces = await workspacesLoading;
    workspacesCache = workspaces;
    workspacesFetchedAt = Date.now();
    return workspaces;
}

function normalizePath(p: string): string {
    return toForwardSlashes(p).toLowerCase();
}

async function resolveWorkspaceId(filePath: string): Promise<string | null> {
    const workspaces = await fetchWorkspaces();
    if (workspaces.length === 0) return null;

    const normalizedFile = normalizePath(filePath);
    let best: WorkspaceInfo | null = null;
    for (const ws of workspaces) {
        const root = ws.rootPath;
        if (root && normalizedFile.startsWith(normalizePath(root))) {
            if (!best || root.length > (best.rootPath?.length || 0)) {
                best = ws;
            }
        }
    }

    return best?.id || workspaces[0]?.id || null;
}

async function fetchPreview(path: string): Promise<PreviewResponse> {
    const wsId = await resolveWorkspaceId(path);
    if (!wsId) {
        throw new Error('No workspace available');
    }

    const params = new URLSearchParams({ path });
    const url = `${getApiBase()}/workspaces/${encodeURIComponent(wsId)}/files/preview?${params}`;
    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${res.status}`);
    }
    return await res.json();
}

function findPathLink(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    if (target.classList.contains('file-path-link')) return target;
    return target.closest('.file-path-link');
}

function findMdLink(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    const link = target.classList.contains('md-link')
        ? target
        : target.closest<HTMLElement>('.md-link');
    if (!link) return null;
    // Skip anchor links (handled separately for ToC navigation)
    if (link.classList.contains('md-anchor-link')) return null;
    return link;
}

function positionTooltip(target: HTMLElement): void {
    const tip = createTooltip();
    const rect = target.getBoundingClientRect();
    const measured = tip.getBoundingClientRect();
    const tipWidth = measured.width > 0
        ? measured.width
        : Math.min(window.innerWidth * 0.8, TOOLTIP_DEFAULT_MAX_WIDTH_PX);
    const tipHeight = measured.height > 0
        ? measured.height
        : Math.min(window.innerHeight * 0.75, TOOLTIP_DEFAULT_MAX_HEIGHT_PX);

    let left = rect.left;
    let top = rect.bottom + TOOLTIP_GAP_PX;
    let isAbove = false;

    if (left + tipWidth > window.innerWidth - TOOLTIP_VIEWPORT_PADDING_PX) {
        left = window.innerWidth - tipWidth - TOOLTIP_VIEWPORT_PADDING_PX;
    }
    if (left < TOOLTIP_EDGE_MARGIN_PX) left = TOOLTIP_EDGE_MARGIN_PX;

    if (top + tipHeight > window.innerHeight - TOOLTIP_VIEWPORT_PADDING_PX) {
        // Try placing above the link
        const aboveTop = rect.top - tipHeight - TOOLTIP_GAP_PX;
        top = Math.max(TOOLTIP_EDGE_MARGIN_PX, aboveTop);
        isAbove = true;
    }

    // Compute max-height so the tooltip never intrudes into the link's bounding rect.
    let maxHeight: number;
    if (isAbove) {
        // Bottom edge of tooltip must stay at or above rect.top - TOOLTIP_GAP_PX
        maxHeight = Math.min(rect.top - TOOLTIP_GAP_PX - top, TOOLTIP_DEFAULT_MAX_HEIGHT_PX);
        if (maxHeight < TOOLTIP_MIN_USEFUL_HEIGHT_PX) {
            // Not enough room above — fall back to below with scroll
            top = rect.bottom + TOOLTIP_GAP_PX;
            maxHeight = Math.min(
                window.innerHeight - TOOLTIP_VIEWPORT_PADDING_PX - top,
                TOOLTIP_DEFAULT_MAX_HEIGHT_PX,
            );
        }
    } else {
        maxHeight = Math.min(
            window.innerHeight - TOOLTIP_VIEWPORT_PADDING_PX - top,
            TOOLTIP_DEFAULT_MAX_HEIGHT_PX,
        );
    }

    tip.style.maxHeight = `${Math.max(maxHeight, TOOLTIP_MIN_USEFUL_HEIGHT_PX)}px`;

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        hideTooltip();
    }, 200);
}

function hideTooltip(): void {
    if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
    }
    if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
    }
    if (tooltipEl) tooltipEl.style.display = 'none';
    activeTarget = null;
}

/** Attach scroll-tracking guard directly to the tooltip body element.
 *  The `scroll` event does not bubble, so a capture listener on the outer
 *  tooltip cannot reliably detect scrolling inside the body. */
function attachBodyScrollGuard(): void {
    if (!tooltipEl) return;
    const body = tooltipEl.querySelector('.file-preview-tooltip-body');
    if (!body) return;
    body.addEventListener('scroll', () => {
        isScrollingTooltip = true;
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
            isScrollingTooltip = false;
            if (tooltipEl && !tooltipEl.matches(':hover')) {
                scheduleHide();
            }
        }, 150);
    });
}

function renderLoading(path: string): void {
    const tip = createTooltip();
    const fileName = path.split('/').pop() || path;
    tip.innerHTML =
        `<div class="file-preview-tooltip-header">${escapeHtml(fileName)}</div>` +
        '<div class="file-preview-tooltip-body file-preview-tooltip-loading">Loading…</div>';
    tip.style.display = 'block';
    attachBodyScrollGuard();
}

function renderError(message: string): void {
    const tip = createTooltip();
    tip.innerHTML =
        '<div class="file-preview-tooltip-header">Preview Error</div>' +
        `<div class="file-preview-tooltip-body file-preview-tooltip-error">${escapeHtml(message)}</div>`;
    tip.style.display = 'block';
    attachBodyScrollGuard();
}

function renderPreview(data: FilePreviewResponse): void {
    const tip = createTooltip();
    const gutterWidth = String(data.lines.length).length + 1;
    const rows = data.lines.map((line, i) =>
        '<div class="file-preview-line">' +
        `<span class="file-preview-line-number" style="min-width:${gutterWidth}ch">${i + 1}</span>` +
        `<span class="file-preview-line-content">${escapeHtml(line) || '\u200B'}</span>` +
        '</div>'
    ).join('');
    const totalLabel = data.truncated ? ` (${data.totalLines} total)` : '';

    const isTaskFile = data.path.includes('.vscode/tasks/');
    const taskRelativePath = isTaskFile
        ? data.path.split('.vscode/tasks/').pop() || ''
        : '';
    const gotoBtn = isTaskFile
        ? `<button class="file-preview-goto-btn" data-task-path="${escapeHtml(taskRelativePath)}" title="Reveal in Tasks Panel">\u2B08</button>`
        : '';

    tip.innerHTML =
        '<div class="file-preview-tooltip-header">' +
        `<span class="file-preview-tooltip-filename">${escapeHtml(data.fileName)}</span>` +
        `<span class="file-preview-tooltip-info">${gotoBtn}${data.lines.length} lines${escapeHtml(totalLabel)}</span>` +
        '</div>' +
        '<div class="file-preview-tooltip-body">' +
        `<div class="file-preview-lines">${rows}</div>` +
        '</div>';
    tip.style.display = 'block';
    attachBodyScrollGuard();
}

function renderDirectoryPreview(data: DirectoryPreviewResponse): void {
    const tip = createTooltip();
    const folderCount = data.entries.filter(e => e.isDirectory).length;
    const fileCount = data.entries.filter(e => !e.isDirectory).length;

    const rows = data.entries.map(e =>
        '<div class="file-preview-dir-entry">' +
        `<span class="file-preview-dir-icon">${e.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>` +
        `<span>${escapeHtml(e.name)}</span>` +
        '</div>'
    ).join('');

    const summary = `${folderCount} folder${folderCount !== 1 ? 's' : ''}, ${fileCount} file${fileCount !== 1 ? 's' : ''}`;
    const totalLabel = data.truncated ? ` (${data.totalEntries} total)` : '';

    tip.innerHTML =
        '<div class="file-preview-tooltip-header">' +
        `<span class="file-preview-tooltip-filename">${escapeHtml(data.dirName)}</span>` +
        `<span class="file-preview-tooltip-info">${escapeHtml(summary + totalLabel)}</span>` +
        '</div>' +
        '<div class="file-preview-tooltip-body">' +
        `<div class="file-preview-dir-listing">${rows}</div>` +
        '</div>';
    tip.style.display = 'block';
    attachBodyScrollGuard();
}

function renderResponse(data: PreviewResponse): void {
    if (data.type === 'directory') {
        renderDirectoryPreview(data);
    } else {
        renderPreview(data as FilePreviewResponse);
    }
}

async function showTooltip(target: HTMLElement): Promise<void> {
    const fullPath = target.getAttribute('data-full-path');
    if (!fullPath) return;

    const reqId = ++activeRequestId;
    activeTarget = target;
    renderLoading(fullPath);
    positionTooltip(target);

    // Brief pointer-events grace period: keep the link clickable if the tooltip
    // renders briefly over it before the cursor has moved away.
    if (tooltipEl) {
        tooltipEl.style.pointerEvents = 'none';
        setTimeout(() => {
            if (tooltipEl) tooltipEl.style.pointerEvents = '';
        }, 150);
    }

    const cached = getFromCache(fullPath);
    if (cached) {
        if (activeTarget !== target || reqId !== activeRequestId) return;
        if (cached.error) renderError(cached.error);
        else if (cached.data) renderResponse(cached.data);
        positionTooltip(target);
        return;
    }

    try {
        const data = await fetchPreview(fullPath);
        setCache(fullPath, data, null);
        if (activeTarget !== target || reqId !== activeRequestId) return;
        renderResponse(data);
        positionTooltip(target);
    } catch (err: any) {
        const msg = err?.message || 'Failed to load preview';
        setCache(fullPath, null, msg);
        if (activeTarget !== target || reqId !== activeRequestId) return;
        renderError(msg);
        positionTooltip(target);
    }
}

function isMobile(): boolean {
    return (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
        /Mobi|Android|iPhone|iPad|Touch/i.test(navigator.userAgent);
}

function initFilePathPreviewDelegation(): void {
    if (!isMobile()) {
        document.body.addEventListener('mouseover', (event) => {
            const target = findPathLink(event.target);
            if (!target) return;

            if (hideTimer) {
                clearTimeout(hideTimer);
                hideTimer = null;
            }
            if (activeTarget === target) return;

            if (hoverTimer) clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => {
                showTooltip(target);
            }, HOVER_DELAY_MS);
        });

        document.body.addEventListener('mouseout', (event) => {
            const target = findPathLink(event.target);
            if (!target) return;

            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }
            scheduleHide();
        });
    }

    // Keep links from navigating when rendered as anchors in markdown.
    document.body.addEventListener('click', (event) => {
        const target = findPathLink(event.target);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();

        const fullPath = target.getAttribute('data-full-path');
        if (!fullPath) return;

        hideTooltip();
        window.dispatchEvent(new CustomEvent('coc-open-markdown-review', {
            detail: { filePath: fullPath },
        }));
    });

    // Click delegation for goto-file buttons inside file preview tooltips.
    document.body.addEventListener('click', (event) => {
        const btn = (event.target as HTMLElement).closest('.file-preview-goto-btn');
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        const taskPath = btn.getAttribute('data-task-path');
        if (!taskPath) return;
        hideTooltip();
        window.dispatchEvent(new CustomEvent('coc-reveal-in-panel', {
            detail: { filePath: taskPath },
        }));
    });

    // Click-through fallback: if the tooltip covers the link and the user clicks
    // on the tooltip body (not a button/anchor), find the underlying .file-path-link
    // and open it.
    document.body.addEventListener('click', (event) => {
        if (!tooltipEl) return;
        const t = event.target as HTMLElement;
        if (!tooltipEl.contains(t)) return;
        if (t.closest('button, a, [role="button"]')) return;

        const x = (event as MouseEvent).clientX;
        const y = (event as MouseEvent).clientY;

        tooltipEl.style.display = 'none';
        const beneath = document.elementFromPoint(x, y);
        tooltipEl.style.display = 'block';

        const link = findPathLink(beneath);
        if (!link) return;

        event.preventDefault();
        event.stopPropagation();

        const fullPath = link.getAttribute('data-full-path');
        if (!fullPath) return;

        hideTooltip();
        window.dispatchEvent(new CustomEvent('coc-open-markdown-review', {
            detail: { filePath: fullPath },
        }));
    });

    // Clear the mousedown scroll-guard flag when the mouse button is released.
    // If the pointer already left the tooltip, schedule a hide after a short delay.
    document.addEventListener('mouseup', () => {
        if (!isScrollingTooltip) return;
        if (scrollEndTimer) clearTimeout(scrollEndTimer);
        scrollEndTimer = setTimeout(() => {
            isScrollingTooltip = false;
            if (tooltipEl && !tooltipEl.matches(':hover')) {
                scheduleHide();
            }
        }, 150);
    });

    // Click delegation for markdown link spans (.md-link) — open referenced files.
    document.body.addEventListener('click', (event) => {
        const target = findMdLink(event.target);
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();

        const href = target.getAttribute('data-href');
        if (!href) return;

        // External URLs — open in new tab
        if (/^https?:\/\/|^mailto:/i.test(href)) {
            window.open(href, '_blank', 'noopener');
            return;
        }

        // Determine the source file for relative path resolution
        const sourceContainer = target.closest('[data-source-file]');
        const sourceFilePath = sourceContainer?.getAttribute('data-source-file') || '';

        hideTooltip();
        window.dispatchEvent(new CustomEvent('coc-open-markdown-review', {
            detail: { filePath: href, sourceFilePath },
        }));
    });
}

const globalKey = '__COC_FILE_PATH_PREVIEW_DELEGATION__';
const globalWindow = window as any;
if (!globalWindow[globalKey]) {
    globalWindow[globalKey] = true;
    initFilePathPreviewDelegation();
}
