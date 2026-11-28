/** Escape a value for a double-quoted HTML attribute (`'` is left as-is). */
export function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function decodeBasicHtmlEntities(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}

/** Plain text of a rendered link label, or `fallback` when it is empty. */
export function plainLinkLabel(renderedText: string, fallback: string): string {
    const withoutTags = renderedText.replace(/<[^>]*>/g, '');
    return decodeBasicHtmlEntities(withoutTags).trim() || fallback;
}

export function escapeMarkdownLinkLabel(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

/** Read one attribute out of a raw HTML attribute string, entity-decoded. */
export function getHtmlAttr(attrs: string, name: string): string {
    const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
    const match = re.exec(attrs);
    return match ? decodeBasicHtmlEntities(match[2]) : '';
}
