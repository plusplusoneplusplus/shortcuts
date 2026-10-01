/**
 * monacoDiffOptions — pure inputs for the working-tree Monaco diff editor.
 *
 * Builds the two model descriptors (URI, text, language) and the diff editor
 * options from props. No Monaco runtime import: everything here is plain data
 * so it can be unit-tested and handed to any editor adapter.
 *
 * URI rules (goal constraint):
 *   - the disk side of an unstaged diff is the real workspace document URI
 *     (`browserDocumentUri`, the scheme the language-server bridge accepts);
 *   - HEAD and index sides are ref-backed and use the distinct
 *     `coc-diff-ref:` scheme, so they can never be mistaken for a live file.
 */

import type { editor as monacoEditor } from 'monaco-editor';
import { browserDocumentUri } from '../../language-servers/documentStore';
import { getMonacoLanguage } from '../../../shared/file-viewer/monacoLanguage';
import type { DiffViewMode } from '../hooks/useDiffViewMode';

/** Working-tree diff stages that have two text sides. */
export type MonacoDiffStage = 'staged' | 'unstaged';

/** Git ref a synthetic side is read from. */
export type DiffRefSide = 'HEAD' | 'INDEX';

/** Scheme for ref-backed (HEAD / index) model URIs. */
export const DIFF_REF_URI_SCHEME = 'coc-diff-ref';

export interface DiffModelDescriptor {
    uri: string;
    text: string;
    language: string;
    /**
     * True only for the real on-disk working copy (the modified side of an
     * unstaged diff). Nothing else may be offered to a language server.
     */
    isWorkingCopy: boolean;
}

export interface DiffModelsInput {
    original: DiffModelDescriptor;
    modified: DiffModelDescriptor;
}

export interface DiffModelsParams {
    workspaceId: string;
    /** Repo-relative path, `/`-separated. */
    relativePath: string;
    stage: MonacoDiffStage;
    /**
     * Immutable source identity for non-working-tree diffs. When present,
     * both sides use ref-backed URIs scoped to this identity.
     */
    modelIdentity?: string;
    original: string;
    modified: string;
}

function encodePath(relativePath: string): string {
    return relativePath
        .replace(/\\/g, '/')
        .split('/')
        .filter(segment => segment.length > 0)
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

/** Synthetic URI for a ref-backed side; distinct per workspace, ref and path. */
export function diffRefUri(workspaceId: string, ref: DiffRefSide, relativePath: string): string {
    return `${DIFF_REF_URI_SCHEME}://${encodeURIComponent(workspaceId)}/${ref}/${encodePath(relativePath)}`;
}

/** Synthetic URI for a side of an immutable commit, range, or PR snapshot. */
export function immutableDiffRefUri(
    workspaceId: string,
    modelIdentity: string,
    side: 'original' | 'modified',
    relativePath: string,
): string {
    return `${DIFF_REF_URI_SCHEME}://${encodeURIComponent(workspaceId)}/${encodeURIComponent(modelIdentity)}/${side}/${encodePath(relativePath)}`;
}

/** True when `uri` is a ref-backed synthetic URI. */
export function isDiffRefUri(uri: string): boolean {
    return uri.startsWith(`${DIFF_REF_URI_SCHEME}://`);
}

/** Last path segment, which is what the language lookup keys on. */
function baseName(relativePath: string): string {
    const parts = relativePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || relativePath;
}

/** Monaco language id for `relativePath`, from its file name. */
export function diffLanguageFor(relativePath: string): string {
    return getMonacoLanguage(baseName(relativePath));
}

/**
 * The two models for one file. Unstaged: index → disk (real URI). Staged:
 * HEAD → index (both synthetic).
 */
export function buildDiffModels(params: DiffModelsParams): DiffModelsInput {
    const { workspaceId, relativePath, stage } = params;
    const language = diffLanguageFor(relativePath);
    if (params.modelIdentity) {
        return {
            original: {
                uri: immutableDiffRefUri(workspaceId, params.modelIdentity, 'original', relativePath),
                text: params.original,
                language,
                isWorkingCopy: false,
            },
            modified: {
                uri: immutableDiffRefUri(workspaceId, params.modelIdentity, 'modified', relativePath),
                text: params.modified,
                language,
                isWorkingCopy: false,
            },
        };
    }
    if (stage === 'unstaged') {
        return {
            original: { uri: diffRefUri(workspaceId, 'INDEX', relativePath), text: params.original, language, isWorkingCopy: false },
            modified: { uri: browserDocumentUri(workspaceId, relativePath), text: params.modified, language, isWorkingCopy: true },
        };
    }
    return {
        original: { uri: diffRefUri(workspaceId, 'HEAD', relativePath), text: params.original, language, isWorkingCopy: false },
        modified: { uri: diffRefUri(workspaceId, 'INDEX', relativePath), text: params.modified, language, isWorkingCopy: false },
    };
}

/** Same URIs and texts: re-applying would only reset the editor. */
export function sameDiffModels(a: DiffModelsInput | null, b: DiffModelsInput | null): boolean {
    if (!a || !b) return a === b;
    const same = (x: DiffModelDescriptor, y: DiffModelDescriptor) =>
        x.uri === y.uri && x.text === y.text && x.language === y.language && x.isWorkingCopy === y.isWorkingCopy;
    return same(a.original, b.original) && same(a.modified, b.modified);
}

export type DiffEditorOptions = monacoEditor.IDiffEditorConstructionOptions;

/**
 * Diff editor options for a view mode. Both sides are read-only; the overview
 * ruler stands in for the classic mini-map; whitespace is not ignored so the
 * hunks match `git diff`.
 */
export function buildDiffEditorOptions(viewMode: DiffViewMode): DiffEditorOptions {
    return {
        renderSideBySide: viewMode === 'split',
        useInlineViewWhenSpaceIsLimited: false,
        readOnly: true,
        originalEditable: false,
        domReadOnly: true,
        ignoreTrimWhitespace: false,
        renderOverviewRuler: true,
        renderIndicators: true,
        renderMarginRevertIcon: false,
        enableSplitViewResizing: true,
        // Sized by the host from a ResizeObserver measurement, like
        // MonacoFileEditor: an inherited size observer fights flex parents.
        automaticLayout: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        folding: false,
        // Hosts the interactive add-comment widget beside a selection.
        glyphMargin: true,
        lineDecorationsWidth: 8,
        lineNumbersMinChars: 3,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    };
}

export type AppTheme = 'auto' | 'dark' | 'light';
export type DiffEditorTheme = 'vs' | 'vs-dark';

/** Monaco theme that follows the app theme; `auto` defers to the OS. */
export function resolveDiffEditorTheme(theme: AppTheme, prefersDark: boolean): DiffEditorTheme {
    if (theme === 'dark') return 'vs-dark';
    if (theme === 'light') return 'vs';
    return prefersDark ? 'vs-dark' : 'vs';
}
