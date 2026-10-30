/**

 * PreviewPane — the Explorer's file preview: a full-bleed viewer plus a
 * floating close/save toolbar.
 *
 * Composition only. `filePreviewIdentity` derives the exact file and its
 * transport/editability policy; `useFilePreviewSession` owns the buffer,
 * dirty/save/discard/reload transitions and the owner registrations;
 * `usePreviewModelAttachment` owns everything attached to the mounted Monaco
 * model. This component renders the viewer, toolbar, notices and badges.
 *
 * It is also the first host of language support (AC-02/AC-03). This is where the
 * decision is made that a blob is a *live repo document*: a real file in this
 * workspace, read whole, reachable on the workspace's own host. A trusted
 * absolute path, a truncated oversize file and a binary blob all stay ordinary
 * viewers with no document behind them. Once that decision is made and the
 * editor has a model, this is also where the model is moved onto its shadow
 * language and the Monaco language providers are registered over the document —
 * one registration per model, disposed with it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Spinner, Button } from '../../../ui';
import { FileViewer } from '../../../shared/file-viewer/FileViewer';
import type {
    EditorModelMountContext,
    EditorNavigationController,
    EditorNavigationReason,
    EditorNavigationSnapshot,
} from '../../../shared/file-viewer/MonacoFileEditor';
import { mountNonEditableModel } from '../../../shared/file-viewer/nonEditableMonacoModel';
import { ReloadFromDiskButton } from '../../../shared/file-viewer/ReloadFromDiskButton';
import { UnifiedPanelCloseConfirm } from '../unified-right-panel/UnifiedPanelCloseConfirm';
import { useMarkdownPreview } from '../../../hooks/ui/useMarkdownPreview';
import { MarkdownSelectionAttachPill } from '../../../shared/markdown-document/MarkdownSelectionAttachPill';
import { LanguageStatusBadge } from '../../language-servers/LanguageStatusBadge';
import { supportsFeature } from '../../language-servers/languageProviders';
import { BinaryRevealAction } from './BinaryRevealAction';
import { MarkdownFileLinkScope } from '../../../shared/file-path/MarkdownFileLinkScope';
import { workspacePreviewUrl } from '../../../shared/file-viewer/workspacePreview';
import { resolveLineRange, toLines } from '../../../shared/file-viewer/lineRange';
import { resolveFilePreviewIdentity, type DefinitionOwner } from './filePreviewIdentity';
import {
    useFilePreviewSession,
    type FileReloadControl,
    type PreviewStatus,
    type PreviewExternalNavigateTarget,
    type PreviewNavigateTarget,
} from './useFilePreviewSession';
import { usePreviewModelAttachment } from './usePreviewModelAttachment';

export type { FileReloadControl, PreviewStatus } from './useFilePreviewSession';

export interface PreviewPaneProps {
    editingScope?: string;
    repoId: string;
    /** Concrete clone identity for file I/O and language transport routing. */
    routingRef?: string | null;
    /** Live repo-group members whose definition sources this pane may preview. */
    definitionPreviewOwners?: readonly DefinitionOwner[];
    /** Relative path from repo root, or prefixed with TRUSTED_PATH_PREFIX for absolute paths */
    filePath: string;
    /** File name for language detection, e.g. "index.ts" */
    fileName: string;
    /** Unified right-panel opt-in; standalone Explorer keeps its Monaco view. */
    markdownPreview?: boolean;
    /** Unified right-panel opt-in: an "Open in Explorer" action under the binary placeholder. */
    revealBinary?: boolean;
    /**
     * One-based line to scroll to and highlight once the content is loaded. Set
     * when the file is opened from a content-search hit.
     */
    revealLine?: number;
    endLine?: number;
    /**
     * One-based column within `revealLine` for the cursor. A search hit leaves it
     * unset; a language-server navigation supplies the target symbol's column.
     */
    revealColumn?: number;
    /**
     * Changes whenever the owner navigated here again, even to the position
     * already shown — a repeat pick of the same symbol. Nothing reads the
     * value; it re-runs the editor's reveal so the line re-centres.
     */
    revealNonce?: number;
    /** Shows that this location came from the fuzzy repository symbol index. */
    symbolCandidate?: boolean;
    onClose?: () => void;
    /**
     * Notified whenever the unsaved-edits state changes (and with `false` on
     * unmount). Lets the owner surface dirtiness to the workspace-switch guard so
     * a switch can prompt before discarding edits (AC-03 of preserve-explorer-state).
     */
    onDirtyChange?: (isDirty: boolean) => void;
    /**
     * Hands the owner a way to save this buffer, so a tab-close prompt can write
     * the file without the user re-visiting the tab (AC-04). Called with the save
     * function while the buffer is editable, and with `null` when it stops being
     * editable or unmounts. The function resolves `true` only when the write
     * succeeded — a failed save leaves the buffer dirty and shows the error here.
     */
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
    /**
     * Notified whenever this buffer starts loading, fails, or settles (and with
     * `'ready'` on unmount). Lets the owner mark the matching tab as loading or
     * errored in the tab strip without reaching into the buffer (AC-05/AC-06).
     */
    onStatusChange?: (status: PreviewStatus) => void;
    /**
     * Notified when the blob read fails with a 404 — the file no longer exists
     * on disk. Lets an owner whose file list may be stale (e.g. the working-tree
     * panel) react by refreshing instead of leaving a dead Retry loop.
     */
    onNotFound?: () => void;
    /**
     * Where a "go to definition" that lands in ANOTHER file should open. The
     * surface that renders this pane owns its tab strip, so it is the one that
     * opens or re-activates the target tab and passes the position back down as
     * `revealLine` / `revealColumn`. A pane whose host sets no handler still
     * navigates within its own file — Monaco does that itself — but a
     * cross-file jump is declined, so nothing silently disappears.
     */
    onNavigate?: (target: PreviewNavigateTarget) => void;
    /**
     * Where a definition that lands OUTSIDE every workspace should open — a
     * standard-library header, a dependency source. The target carries the
     * host's opaque capability, never a path, and opens read-only. A host that
     * sets no handler declines the jump rather than showing the user nothing.
     */
    onNavigateExternal?: (target: PreviewExternalNavigateTarget) => void;
    /** Registers this file's live Monaco location capture/restore handle. */
    onNavigationMount?: (controller: EditorNavigationController | null) => void;
    /** Reports cursor, scroll, search, diagnostic, and language-jump locations. */
    onNavigationLocation?: (snapshot: EditorNavigationSnapshot, reason: EditorNavigationReason) => void;
    /**
     * Publishes the live text model (and `null` when it goes away), so a second
     * view of this file can attach to the same buffer instead of reading its own.
     */
    onModelShare?: (context: EditorModelMountContext | null) => void;
    /**
     * Hands a host-rendered "Reload from disk" control its handler and busy
     * state (and `null` on unmount). A host that sets it renders the button
     * itself; without it the button sits in this pane's floating toolbar.
     */
    onReloadControlChange?: (control: FileReloadControl | null) => void;
}

function RenderedMarkdown({ content, selectionContext }: {
    content: string;
    selectionContext?: { workspaceId: string; filePath: string; destinationId: string };
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { html } = useMarkdownPreview({ content, containerRef, viewMode: 'review', stripFrontmatter: true });
    return (
        <div className="h-full overflow-auto pt-9" data-testid="preview-markdown-scroll">
            <div className="relative">
                <div
                    ref={containerRef}
                    className="markdown-body p-4 text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                    data-testid="preview-markdown"
                    dangerouslySetInnerHTML={{ __html: html }}
                />
                {selectionContext && <MarkdownSelectionAttachPill containerRef={containerRef} content={content} {...selectionContext} />}
            </div>
        </div>
    );
}

export function PreviewPane({ editingScope, repoId, routingRef, definitionPreviewOwners, filePath, fileName, markdownPreview = false, revealBinary = false, revealLine, endLine, revealColumn, revealNonce, symbolCandidate, onClose, ...host }: PreviewPaneProps) {
    const identity = useMemo(
        () => resolveFilePreviewIdentity({ workspaceId: repoId, routingRef, editingScope, filePath }),
        [repoId, routingRef, editingScope, filePath],
    );
    const { readOnly, path: actualPath, ownerKey } = identity;
    const isTrusted = identity.kind === 'trusted';
    const isWorkspacePreview = identity.kind === 'workspace-preview';

    const session = useFilePreviewSession({
        identity,
        fileName,
        markdownPreview,
        reveal: { line: revealLine, endLine, column: revealColumn, nonce: revealNonce },
        host,
    });
    const {
        content: { displayBlob, isOversized, loading, error, retry, isDirty, isSaving },
        deleting, viewOnly, languageEnabled, languageDocument, markdown, revealRetired, reloadControl: reload,
    } = session;

    const languageView = languageDocument.view;
    const definitionSupported = supportsFeature(languageDocument.snapshot?.state, 'definition')
        || languageView?.getServerInfos().some(info => supportsFeature(info.state, 'definition')) === true;
    const { mountModel: mountLanguageModel, identityFailure } = usePreviewModelAttachment({
        identity,
        fileName,
        definitionPreviewOwners,
        languageView,
        definitionSupported,
        host,
        navigationControllerRef: session.navigationControllerRef,
        restoreRawView: markdown.restoreRawView,
    });

    // Publishes the live model to the owner so a second view of this file can
    // attach to the same buffer instead of reading its own.
    const { onModelShare } = host;
    const modelShareRef = useRef(onModelShare);
    modelShareRef.current = onModelShare;
    const sharesModel = onModelShare !== undefined;
    const mountModel = displayBlob?.encoding === 'utf-8'
        ? (viewOnly ? mountNonEditableModel : mountLanguageModel)
        : undefined;
    const { editorRef } = session;
    const mountSharedModel = useMemo(() => (mountModel
        ? (context: EditorModelMountContext) => {
            editorRef.current = context.editor;
            const cleanup = mountModel(context);
            if (sharesModel) modelShareRef.current?.(context);
            return () => {
                if (sharesModel) modelShareRef.current?.(null);
                if (editorRef.current === context.editor) editorRef.current = null;
                cleanup?.();
            };
        }
        : undefined
    ), [mountModel, sharesModel, editorRef]);

    const [downloadError, setDownloadError] = useState('');
    const [downloading, setDownloading] = useState(false);
    useEffect(() => setDownloadError(''), [repoId, routingRef, actualPath]);
    const download = useCallback(async () => {
        setDownloadError('');
        setDownloading(true);
        try {
            const response = await fetch(workspacePreviewUrl(repoId, actualPath, routingRef));
            if (!response.ok) throw new Error(`Download failed (${response.status}).`);
            const url = URL.createObjectURL(await response.blob());
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = fileName;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        } catch (err) {
            setDownloadError(err instanceof Error ? err.message : 'Download failed.');
        } finally {
            setDownloading(false);
        }
    }, [repoId, actualPath, routingRef, fileName]);

    return (
        <div className="relative w-full h-full overflow-hidden" data-testid="preview-pane">
            {identityFailure && <div role="alert">{identityFailure.message} <button type="button" onClick={identityFailure.retry}>Retry Go to Definition</button></div>}
            {/* Floating toolbar: close + save controls */}
            {!loading && (
                <div
                    className="absolute top-2 right-6 z-10 flex items-center gap-1.5"
                    data-testid="preview-toolbar"
                >
                    {!isTrusted && (error || isOversized || displayBlob?.encoding === 'base64') && (
                        <button type="button" onClick={download} disabled={downloading}
                            className="text-xs px-2 py-0.5 rounded bg-white dark:bg-[#2d2d2d] border border-[#c8c8c8] dark:border-[#555]"
                            data-testid="preview-download">
                            {downloading ? 'Downloading...' : 'Download'}
                        </button>
                    )}
                    {isDirty && !isTrusted && (
                        <button
                            className="text-[10px] px-2 py-0.5 rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-50 transition-colors shadow-sm"
                            onClick={session.handleSave}
                            disabled={isSaving || deleting}
                            data-testid="save-btn"
                        >
                            {isSaving ? 'Saving…' : 'Save'}
                        </button>
                    )}
                    {isDirty && !isTrusted && (
                        <button
                            className="text-[10px] px-2 py-0.5 rounded border border-[#c8c8c8] dark:border-[#555] bg-white dark:bg-[#2d2d2d] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f0f0f0] dark:hover:bg-[#3c3c3c] disabled:opacity-50 transition-colors shadow-sm"
                            onClick={session.handleDiscard}
                            disabled={isSaving || deleting}
                            title="Discard unsaved changes"
                            data-testid="discard-btn"
                        >
                            Discard
                        </button>
                    )}
                    {isDirty && !isTrusted && (
                        <span className="w-2 h-2 rounded-full bg-[#f59e0b] flex-shrink-0" title="Unsaved changes" data-testid="dirty-indicator" />
                    )}
                    {!reload.hosted && !error && (
                        <ReloadFromDiskButton onReload={reload.request} busy={reload.busy} />
                    )}
                    {markdown.canPreview && (
                        <div role="group" aria-label="Markdown view" className="flex rounded border border-[#bcbcbc] bg-[#fafafa] text-xs dark:border-[#555] dark:bg-[#252525]">
                            {(['Rendered', 'Raw'] as const).map(mode => (
                                <button
                                    key={mode}
                                    type="button"
                                    aria-pressed={(mode === 'Rendered') === markdown.showRendered}
                                    onClick={mode === 'Rendered' ? markdown.showRenderedView : markdown.showRaw}
                                    className={`rounded px-2 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0078d4] ${
                                        (mode === 'Rendered') === markdown.showRendered
                                            ? 'bg-[#0078d4] text-white'
                                            : 'text-[#555] hover:bg-black/5 dark:text-[#ccc] dark:hover:bg-white/10'
                                    }`}
                                >
                                    {mode}
                                </button>
                            ))}
                        </div>
                    )}
                    {onClose && (
                        <button
                            className="w-5 h-5 flex items-center justify-center rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/5 dark:hover:bg-white/10 text-sm transition-colors"
                            onClick={onClose}
                            title="Close preview"
                            data-testid="preview-close-btn"
                        >
                            ×
                        </button>
                    )}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center gap-2 h-full text-xs text-[#848484]" data-testid="preview-loading">
                    <Spinner size="sm" /> Loading {fileName}…
                </div>
            ) : error ? (
                <div className="flex items-center gap-2 px-4 py-4" data-testid="preview-error">
                    <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                    <Button variant="secondary" size="sm" onClick={retry} data-testid="preview-retry-btn">Retry</Button>
                </div>
            ) : displayBlob ? (
                <MarkdownFileLinkScope workspaceId={repoId} routingRef={routingRef} sourceFilePath={actualPath}>
                    {markdown.showRendered ? <RenderedMarkdown content={displayBlob.content} selectionContext={readOnly ? undefined : {
                        workspaceId: repoId,
                        filePath: actualPath,
                        destinationId: routingRef ?? repoId,
                    }} /> :
                    <FileViewer
                        selectionContext={readOnly ? undefined : {
                            workspaceId: repoId,
                            filePath: actualPath,
                            destinationId: routingRef ?? repoId,
                        }}
                        blob={displayBlob}
                        fileName={fileName}
                        onChange={session.handleEditorChange}
                        readOnly={viewOnly}
                        onSave={viewOnly ? undefined : session.handleSave}
                        markdown={isWorkspacePreview && !markdown.canPreview ? 'toggle' : 'off'}
                        revealLine={revealRetired ? undefined : revealLine}
                        highlightRange={!revealRetired && endLine !== undefined && displayBlob.encoding === 'utf-8'
                            ? resolveLineRange(revealLine, endLine, toLines(displayBlob.content).length) : null}
                        revealColumn={revealColumn}
                        revealNonce={revealNonce}
                        markers={languageEnabled ? languageDocument.markers : undefined}
                        onModelMount={mountSharedModel}
                        codeTestId="monaco-container"
                        binaryActions={revealBinary ? (
                            <BinaryRevealAction
                                key={`${ownerKey}:${actualPath}`}
                                repoId={repoId}
                                routingRef={routingRef}
                                path={actualPath}
                                available={!readOnly}
                            />
                        ) : undefined}
                    />}
                </MarkdownFileLinkScope>
            ) : null}
            {!loading && !error && isOversized && (
                <div className="absolute bottom-1 left-3 text-xs text-[#848484]" data-testid="preview-oversized">
                    File exceeds 10 MB; showing a truncated, read-only preview.
                </div>
            )}
            {reload.notice && (
                <div
                    role={reload.notice.error ? 'alert' : 'status'}
                    className={`absolute left-3 right-3 top-9 z-20 flex items-start gap-2 rounded border px-2 py-1 text-xs shadow-sm ${
                        reload.notice.error
                            ? 'border-[#f1b8ad] bg-[#fdf0ee] text-[#a1260d] dark:border-[#5a1d1d] dark:bg-[#3a1d1d] dark:text-[#f48771]'
                            : 'border-[#c8c8c8] bg-white text-[#1e1e1e] dark:border-[#555] dark:bg-[#2d2d2d] dark:text-[#cccccc]'
                    }`}
                    data-testid="file-reload-notice"
                >
                    <span className="min-w-0 flex-1">{reload.notice.message}</span>
                    <button
                        type="button"
                        aria-label="Dismiss"
                        className="flex-shrink-0 rounded px-1 hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={reload.dismissNotice}
                    >
                        ×
                    </button>
                </div>
            )}
            {reload.prompt && (
                <UnifiedPanelCloseConfirm
                    label="Confirm reload"
                    message={`Reload ${fileName} from disk? Your unsaved changes will be lost.`}
                    confirmLabel="Discard and reload"
                    onCancel={reload.cancel}
                    onConfirm={reload.confirm}
                />
            )}
            {downloadError && <div role="alert" className="absolute bottom-2 left-2 text-xs text-red-600">{downloadError}</div>}

            {!loading && !error && languageEnabled && (
                <div className="absolute bottom-1 right-3 z-10 max-w-[70%] pointer-events-none">
                    <LanguageStatusBadge
                        snapshot={languageDocument.snapshot}
                        onRestart={languageDocument.restart}
                        variant="corner"
                    />
                </div>
            )}
            {!loading && !error && symbolCandidate && (
                <div
                    className="absolute bottom-1 left-3 z-10 rounded border border-amber-500/50 bg-amber-100/95 px-2 py-0.5 text-[10px] font-medium text-amber-900 shadow-sm dark:bg-amber-950/95 dark:text-amber-200"
                    title="This file was opened from a repository symbol candidate that clangd did not confirm."
                    data-testid="symbol-candidate-badge"
                >
                    Symbol candidate
                </div>
            )}
        </div>
    );
}
