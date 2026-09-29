/**
 * diffLanguageEligibility — which side of a working-tree diff may talk to a
 * language server (AC-06).
 *
 * Exactly one model ever qualifies: the modified side of an **unstaged** diff,
 * which is the real file on disk and carries the same `coc-file:` document URI
 * the explorer uses. The original side and both sides of a staged diff are git
 * blobs (HEAD / index) on synthetic `coc-diff-ref:` URIs; registering them would
 * put a second, different text under the file's identity and let diagnostics
 * from HEAD land on the working copy.
 *
 * Pure: no Monaco, no React, no store. The editor adapter repeats the URI check
 * against the model Monaco actually holds (see `attachModifiedLanguage`).
 */

import { browserDocumentUri } from '../../language-servers/documentStore';
import { MAX_FILE_VIEW_SIZE } from '../../../shared/file-viewer/useFileContent';
import { isDiffRefUri, type DiffModelsInput, type MonacoDiffStage } from './monacoDiffOptions';

/**
 * Language features stop above the explorer's own threshold: the explorer
 * truncates such files and never offers them to a server either.
 */
export const DIFF_LANGUAGE_MAX_CHARS = MAX_FILE_VIEW_SIZE;

export type DiffLanguageIneligibleReason =
    | 'no-workspace'
    | 'staged'
    | 'not-working-copy'
    | 'synthetic-uri'
    | 'foreign-uri'
    | 'oversized';

export type DiffLanguageTarget =
    | { eligible: true; path: string; uri: string }
    | { eligible: false; reason: DiffLanguageIneligibleReason };

export interface DiffLanguageTargetInput {
    workspaceId: string;
    /** Repo-relative, `/`-separated path. */
    relativePath: string;
    stage: MonacoDiffStage;
    models: DiffModelsInput;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** The document a diff may open with the language server, or why it may not. */
export function resolveDiffLanguageTarget(input: DiffLanguageTargetInput): DiffLanguageTarget {
    const { workspaceId, stage, models } = input;
    const path = normalizePath(input.relativePath);
    if (!workspaceId || !path) return { eligible: false, reason: 'no-workspace' };
    if (stage !== 'unstaged') return { eligible: false, reason: 'staged' };
    const modified = models.modified;
    if (!modified.isWorkingCopy) return { eligible: false, reason: 'not-working-copy' };
    if (isDiffRefUri(modified.uri)) return { eligible: false, reason: 'synthetic-uri' };
    const uri = browserDocumentUri(workspaceId, path);
    if (modified.uri !== uri) return { eligible: false, reason: 'foreign-uri' };
    if (modified.text.length > DIFF_LANGUAGE_MAX_CHARS) return { eligible: false, reason: 'oversized' };
    return { eligible: true, path, uri };
}
