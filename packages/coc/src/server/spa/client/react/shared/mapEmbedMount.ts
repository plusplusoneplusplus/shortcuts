import {
    DEFAULT_MAP_EMBED_HEIGHT,
    MAX_MAP_EMBED_HEIGHT,
    MIN_MAP_EMBED_HEIGHT,
    isEmbeddableMapUrl,
} from '@plusplusoneplusplus/forge/editor/rendering';

function clampHeight(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_MAP_EMBED_HEIGHT;
    return Math.min(MAX_MAP_EMBED_HEIGHT, Math.max(MIN_MAP_EMBED_HEIGHT, Math.round(value)));
}

function storageKey(href: string): string {
    return `mapEmbedHeight:${href}`;
}

function getStoredHeight(href: string, fallback = DEFAULT_MAP_EMBED_HEIGHT): number {
    try {
        const raw = window.localStorage.getItem(storageKey(href));
        if (!raw) return fallback;
        return clampHeight(Number.parseInt(raw, 10));
    } catch {
        return fallback;
    }
}

function setStoredHeight(href: string, height: number): void {
    try {
        window.localStorage.setItem(storageKey(href), String(clampHeight(height)));
    } catch {
        // Ignore storage quota/privacy-mode failures; resizing still works for this render.
    }
}

function showInvalidUrl(placeholder: HTMLElement, href: string): void {
    placeholder.dataset.mounted = '1';
    placeholder.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'md-map-embed-error';
    error.textContent = href
        ? 'Unsupported Google Maps embed URL'
        : 'Missing Google Maps embed URL';
    placeholder.appendChild(error);
}

function mountOne(placeholder: HTMLElement): void {
    const href = placeholder.dataset.mapUrl || '';
    if (!isEmbeddableMapUrl(href)) {
        showInvalidUrl(placeholder, href);
        return;
    }

    const label = placeholder.dataset.mapLabel?.trim() || 'Google Maps';
    const height = getStoredHeight(href);
    let currentHeight = height;

    placeholder.dataset.mounted = '1';
    placeholder.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'md-map-embed-shell';

    const toolbar = document.createElement('div');
    toolbar.className = 'md-map-embed-toolbar';

    const title = document.createElement('span');
    title.className = 'md-map-embed-title';
    title.title = href;
    title.textContent = label;

    const actions = document.createElement('span');
    actions.className = 'md-map-embed-actions';

    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open in Google Maps';
    open.addEventListener('click', () => window.open(href, '_blank', 'noopener,noreferrer'));

    actions.append(open);
    toolbar.append(title, actions);

    const frameWrap = document.createElement('div');
    frameWrap.className = 'md-map-embed-frame-wrap';
    frameWrap.style.height = `${height}px`;

    const iframe = document.createElement('iframe');
    iframe.className = 'md-map-embed-frame';
    iframe.src = href;
    iframe.title = label;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    iframe.setAttribute('loading', 'lazy');

    const resize = document.createElement('div');
    resize.className = 'md-map-embed-resize';
    resize.title = 'Drag to resize';
    resize.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = currentHeight;
        const onMove = (moveEvent: MouseEvent) => {
            currentHeight = clampHeight(startHeight + moveEvent.clientY - startY);
            frameWrap.style.height = `${currentHeight}px`;
            iframe.style.height = `${currentHeight}px`;
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            setStoredHeight(href, currentHeight);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    frameWrap.append(iframe, resize);
    shell.append(toolbar, frameWrap);
    placeholder.appendChild(shell);
}

export function mountMapEmbeds(root: ParentNode | null | undefined): void {
    if (!root) return;
    const placeholders = Array.from(root.querySelectorAll<HTMLElement>('.md-map-embed:not([data-mounted])'));
    for (const placeholder of placeholders) {
        mountOne(placeholder);
    }
}
