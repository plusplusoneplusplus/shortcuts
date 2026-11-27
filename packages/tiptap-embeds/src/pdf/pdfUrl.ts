import { isPdfUrl } from '../urls/index.js';

/** How a PDF block may expose its stored URL. */
export type PdfUrlClassification =
    | { kind: 'inline'; href: string }
    | { kind: 'link'; href: string }
    | { kind: 'invalid' };

/**
 * Default rule for a stored PDF block URL: a same-origin HTTP(S) URL whose path
 * ends in `.pdf` renders inline, a cross-origin one is offered as a link only,
 * and anything else (other schemes, credentials, non-PDF paths) is invalid.
 * Relative URLs resolve against `appOrigin`.
 */
export function classifyPdfUrl(rawUrl: string, appOrigin: string): PdfUrlClassification {
    let appUrl: URL;
    let parsedUrl: URL;
    try {
        appUrl = new URL(appOrigin);
        parsedUrl = new URL(rawUrl, appUrl);
    } catch {
        return { kind: 'invalid' };
    }

    if (
        !rawUrl.trim()
        || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
        || parsedUrl.username
        || parsedUrl.password
        || !isPdfUrl(parsedUrl.pathname)
    ) {
        return { kind: 'invalid' };
    }

    return parsedUrl.origin === appUrl.origin
        ? { kind: 'inline', href: parsedUrl.href }
        : { kind: 'link', href: parsedUrl.href };
}
