import {
    DEFAULT_HTML_EMBED_HEIGHT,
    MAX_HTML_EMBED_HEIGHT,
    MIN_HTML_EMBED_HEIGHT,
} from '@plusplusoneplusplus/forge/editor/rendering';
import { getSpaApiUrl, getSpaCocClient } from '../api/cocClient';

function clampHeight(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_HTML_EMBED_HEIGHT;
    return Math.min(MAX_HTML_EMBED_HEIGHT, Math.max(MIN_HTML_EMBED_HEIGHT, Math.round(value)));
}

function basename(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.split('/').filter(Boolean).pop() || 'HTML preview';
}

function storageKey(wsId: string, href: string): string {
    return `htmlEmbedHeight:${wsId}:${href}`;
}

function getStoredHeight(wsId: string, href: string, fallback: number): number {
    try {
        const raw = window.localStorage.getItem(storageKey(wsId, href));
        if (!raw) return fallback;
        return clampHeight(Number.parseInt(raw, 10));
    } catch {
        return fallback;
    }
}

function setStoredHeight(wsId: string, href: string, height: number): void {
    try {
        window.localStorage.setItem(storageKey(wsId, href), String(clampHeight(height)));
    } catch {
        // Ignore storage quota/privacy-mode failures; resizing still works for this render.
    }
}

function proxyUrl(wsId: string, href: string): string {
    return getSpaApiUrl(`/workspaces/${encodeURIComponent(wsId)}/files/html`, { path: href });
}

function showError(container: HTMLElement, url: string): void {
    container.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'md-html-embed-error';
    error.textContent = 'Could not load preview · ';
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'open file';
    error.prepend(document.createTextNode('Warning: '));
    error.appendChild(link);
    container.appendChild(error);
}

function mountOne(placeholder: HTMLElement, wsId: string): void {
    const href = placeholder.dataset.htmlPath || '';
    if (!href) return;
    const requestedHeight = clampHeight(Number.parseInt(placeholder.dataset.embedHeight || '', 10));
    const height = getStoredHeight(wsId, href, requestedHeight);
    const url = proxyUrl(wsId, href);

    placeholder.dataset.mounted = '1';
    placeholder.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'md-html-embed-shell';

    const toolbar = document.createElement('div');
    toolbar.className = 'md-html-embed-toolbar';

    const title = document.createElement('span');
    title.className = 'md-html-embed-title';
    title.title = href;
    title.textContent = basename(href);

    const actions = document.createElement('span');
    actions.className = 'md-html-embed-actions';

    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open in new tab';
    open.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));

    const reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';

    actions.append(open, reload);
    toolbar.append(title, actions);

    const frameWrap = document.createElement('div');
    frameWrap.className = 'md-html-embed-frame-wrap';
    frameWrap.style.height = `${height}px`;

    const loading = document.createElement('div');
    loading.className = 'md-html-embed-loading';
    loading.textContent = 'Loading preview...';

    const iframe = document.createElement('iframe');
    iframe.className = 'md-html-embed-frame';
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('loading', 'lazy');
    iframe.title = 'Embedded HTML preview';
    iframe.addEventListener('load', () => loading.remove());
    iframe.addEventListener('error', () => showError(frameWrap, url));

    const resize = document.createElement('div');
    resize.className = 'md-html-embed-resize';
    resize.title = 'Drag to resize';
    resize.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = frameWrap.getBoundingClientRect().height || height;
        const onMove = (moveEvent: MouseEvent) => {
            const next = clampHeight(startHeight + moveEvent.clientY - startY);
            frameWrap.style.height = `${next}px`;
            iframe.style.height = `${next}px`;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            setStoredHeight(wsId, href, frameWrap.getBoundingClientRect().height || height);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    const loadFrame = async () => {
        loading.textContent = 'Loading preview...';
        if (!loading.isConnected) frameWrap.prepend(loading);
        try {
            await getSpaCocClient().tasks.previewWorkspaceHtml(wsId, href);
            iframe.src = url;
            if (!iframe.isConnected) frameWrap.appendChild(iframe);
            if (!resize.isConnected) frameWrap.appendChild(resize);
        } catch {
            showError(frameWrap, url);
        }
    };

    reload.addEventListener('click', () => {
        iframe.removeAttribute('src');
        void loadFrame();
    });

    frameWrap.append(loading, iframe, resize);
    shell.append(toolbar, frameWrap);
    placeholder.appendChild(shell);
    void loadFrame();
}

export function mountHtmlEmbeds(root: ParentNode | null | undefined, options?: { workspaceId?: string }): void {
    if (!root) return;
    const placeholders = Array.from(root.querySelectorAll<HTMLElement>('.md-html-embed:not([data-mounted])'));
    for (const placeholder of placeholders) {
        const wsId = options?.workspaceId
            ?? placeholder.closest<HTMLElement>('[data-ws-id]')?.dataset.wsId;
        if (!wsId) continue;
        mountOne(placeholder, wsId);
    }
}
