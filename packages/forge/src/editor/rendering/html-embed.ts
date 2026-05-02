export const DEFAULT_HTML_EMBED_HEIGHT = 600;
export const MIN_HTML_EMBED_HEIGHT = 120;
export const MAX_HTML_EMBED_HEIGHT = 2000;

export interface HtmlEmbedOptions {
    enabled: true;
    height: number;
}

export function parseHtmlEmbedTitle(title: string | null | undefined): HtmlEmbedOptions | null {
    if (!title) return null;
    const trimmed = title.trim();
    const match = /^embed(?::(\d+))?$/i.exec(trimmed);
    if (!match) return null;

    const requestedHeight = match[1] ? Number.parseInt(match[1], 10) : DEFAULT_HTML_EMBED_HEIGHT;
    const height = Number.isFinite(requestedHeight)
        ? Math.min(MAX_HTML_EMBED_HEIGHT, Math.max(MIN_HTML_EMBED_HEIGHT, requestedHeight))
        : DEFAULT_HTML_EMBED_HEIGHT;
    return { enabled: true, height };
}

export function isEmbeddableHtmlPath(href: string | null | undefined): boolean {
    if (!href) return false;
    const trimmed = href.trim();
    if (/^(?:https?:|mailto:|data:|javascript:)/i.test(trimmed)) return false;
    const withoutFragment = trimmed.split('#', 1)[0];
    const withoutQuery = withoutFragment.split('?', 1)[0];
    return /\.(?:html|htm)$/i.test(withoutQuery);
}
