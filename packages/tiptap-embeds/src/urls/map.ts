export const DEFAULT_MAP_EMBED_HEIGHT = 400;
export const MIN_MAP_EMBED_HEIGHT = 160;
export const MAX_MAP_EMBED_HEIGHT = 1200;

export function isEmbeddableMapUrl(href: string | null | undefined): boolean {
    if (!href) return false;

    let url: URL;
    try {
        url = new URL(href.trim());
    } catch {
        return false;
    }

    if (url.protocol !== 'https:') return false;

    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, '');
    const hasQuery = url.search.length > 1;

    if (hostname === 'www.google.com' || hostname === 'maps.google.com') {
        if (pathname === '/maps/embed' && hasQuery) return true;
        if (pathname === '/maps' && url.searchParams.get('output') === 'embed') return true;
    }

    return false;
}
