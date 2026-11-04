import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';

/** The workspace-relative spelling used by language documents and their URIs. */
export function normalizeLanguageDocumentPath(path: string): string {
    return toForwardSlashes(path).replace(/^\/+/, '');
}
