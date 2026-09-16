/**
 * Browser-side identity for a read-only file outside every workspace.
 *
 * clangd can answer "go to definition" with a standard-library header. The host
 * keeps that file's path and hands back `coc-lsp-external://<id>/<basename>`,
 * where the id is an opaque capability bound to the attachment that asked. This
 * module is the only place the editor takes that URI apart: everything else
 * passes the id back to the owning attachment and gets content, never a path.
 */

/** Scheme for an external, read-only definition source. */
export const EXTERNAL_URI_SCHEME = 'coc-lsp-external';

/** Shown in the tab strip and the Peek header next to the file name. */
export const EXTERNAL_SOURCE_LABEL = 'External · Read only';

/** What the owning host returns for an authorized external read. */
export interface ExternalSourceContent {
    content: string;
    /** Basename only; the host never sends a directory. */
    displayName: string;
    /** File extension or the session's language id, for Monaco's language pick. */
    languageHint?: string;
}

/** Browser-facing URI for a capability the host issued. */
export function externalResourceUri(resourceId: string, displayName: string): string {
    return `${EXTERNAL_URI_SCHEME}://${encodeURIComponent(resourceId)}/${encodeURIComponent(displayName)}`;
}

/** Inverse of {@link externalResourceUri}; `null` for any other URI. */
export function parseExternalResourceUri(
    uri: string,
): { resourceId: string; displayName: string } | null {
    const match = new RegExp(`^${EXTERNAL_URI_SCHEME}://([^/?#]+)/([^/?#]*)`).exec(uri);
    if (!match) return null;
    try {
        const resourceId = decodeURIComponent(match[1]);
        if (resourceId === '') return null;
        return { resourceId, displayName: decodeURIComponent(match[2]) || 'source' };
    } catch {
        return null;
    }
}

/**
 * Monaco language for an external source. The display basename decides when it
 * carries an extension; a libstdc++ header such as `string_view` does not, so
 * the host's language hint — the extension, else the session's language id — is
 * what keeps it highlighted as C++ instead of plain text.
 */
export function externalSourceLanguageId(
    source: { displayName: string; languageHint?: string },
    languageForFileName: (fileName: string) => string,
): string {
    const byName = languageForFileName(source.displayName);
    if (byName !== 'plaintext') return byName;
    const hint = source.languageHint?.trim().toLowerCase();
    if (!hint) return byName;
    const byHint = languageForFileName(`source.${hint}`);
    return byHint === 'plaintext' ? hint : byHint;
}
