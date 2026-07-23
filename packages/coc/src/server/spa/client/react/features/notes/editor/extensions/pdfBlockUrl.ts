import { isPdfUrl } from '@plusplusoneplusplus/forge/editor/rendering';

export type PdfBlockUrlClassification =
    | { kind: 'inline'; href: string }
    | { kind: 'link'; href: string }
    | { kind: 'invalid' };

const NOTES_PDF_ROUTE = /^\/api\/workspaces\/[^/]+\/notes\/(?:image|local-image)$/;
const PDF_PATH_SUFFIX = /\.pdf$/i;

/**
 * Classify a persisted PDF block URL before exposing it to an iframe or link.
 *
 * Only the same-origin Notes byte-serving routes are trusted for inline
 * rendering. Other HTTP(S) PDF URLs remain available as normalized links.
 */
export function classifyPdfBlockUrl(
    rawUrl: string,
    appOrigin: string,
): PdfBlockUrlClassification {
    let appUrl: URL;
    let parsedUrl: URL;
    try {
        appUrl = new URL(appOrigin);
        parsedUrl = new URL(rawUrl, appUrl);
    } catch {
        return { kind: 'invalid' };
    }

    if (
        (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
        || parsedUrl.username
        || parsedUrl.password
    ) {
        return { kind: 'invalid' };
    }

    const isNotesPdfRoute = parsedUrl.origin === appUrl.origin
        && NOTES_PDF_ROUTE.test(parsedUrl.pathname);

    if (isNotesPdfRoute) {
        const paths = parsedUrl.searchParams.getAll('path');
        if (paths.length === 1 && PDF_PATH_SUFFIX.test(paths[0])) {
            return { kind: 'inline', href: parsedUrl.href };
        }
        return { kind: 'invalid' };
    }

    if (isPdfUrl(parsedUrl.pathname)) {
        return { kind: 'link', href: parsedUrl.href };
    }

    return { kind: 'invalid' };
}
