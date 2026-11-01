/**
 * WhisperDiffPanel — the read-only review surface for a chat's captured file
 * changes, shared by the chat's docked panel and the unified panel's
 * "N files changed" / Changes tabs.
 *
 * It reuses the Git/PR review shell rather than drawing its own: `ReviewFiles`
 * supplies the changed-files tree, selection, filters, resize separator and
 * narrow drawer, and each captured diff renders in `MonacoFileDiffViewer`.
 *
 * The data is the snapshot replayed from the chat's tool calls
 * (`useWhisperDiffState`) — never the current disk, Git HEAD or another turn —
 * so the panel shows only what those calls captured (see
 * `whisperReviewModel`): a created file opens against an empty original;
 * snippet edits open as their captured snippets only, under a notice, with
 * line numbers only where the patch anchored them; deleted and
 * non-reconstructable files say that no diff was captured. The Classic engine
 * preference and editor failures fall back to the reconstructed patch.
 *
 * Selection starts at the entry point's `focusPath` (a popover file row) or the
 * first file in tree order (the "N files" footer), and resets when a new open
 * replaces the context. A live source (a chat's Changes tab) passes a stable
 * `selectionKey`, so its rebuilds keep the user's selection.
 *
 * There is no I/O, so nothing here can reach another workspace or server; the
 * owning workspace scopes the editor's synthetic models and the review state.
 */
import { useMemo, useState } from 'react';
import { ReviewFiles, type ReviewFileRenderContext } from '../../git/diff/ReviewFiles';
import { UnifiedDiffViewer } from '../../git/diff/UnifiedDiffViewer';
import { MonacoFileDiffViewer } from '../../git/diff/MonacoFileDiffViewer';
import type { DiffEditorFactory } from '../../git/diff/monacoDiffEditorAdapter';
import { DiffEngineToggle, DiffViewToggle, DiffWordWrapToggle } from '../../git/diff/DiffViewToggle';
import { DiffEngineFallbackBanner } from '../../git/diff/DiffEngineFallbackBanner';
import { reviewFileParts } from '../../git/diff/gitReviewFiles';
import { useDiffEngine } from '../../git/hooks/useDiffEngine';
import { useDiffViewMode } from '../../git/hooks/useDiffViewMode';
import type { CombinedWhisperDiffView, WhisperDiffState } from './useWhisperDiffState';
import { buildWhisperReviewEntries, whisperReviewContentKey, type WhisperReviewEntry } from './whisperReviewModel';

/** "N files (+X −Y)" — mirrors the popover footer's totals formatting. */
function combinedTotalsLabel(view: CombinedWhisperDiffView): string {
    const { fileCount, totalInsertions, totalDeletions } = view;
    const parts: string[] = [];
    if (totalInsertions > 0) parts.push(`+${totalInsertions}`);
    if (totalDeletions > 0) parts.push(`−${totalDeletions}`);
    const totals = parts.length ? ` (${parts.join(' ')})` : '';
    return `${fileCount} file${fileCount !== 1 ? 's' : ''}${totals}`;
}

export interface WhisperDiffPanelProps {
    /** Renderable diff state from `useWhisperDiffState` (whole-group view + files). */
    state: WhisperDiffState;
    /** Current workspace root, used to show project-relative paths. */
    workspaceRootPath?: string | null;
    /** Close the panel. */
    onClose: () => void;
    /** Monaco diff editor factory; tests pass an owned adapter. */
    createDiffEditor?: DiffEditorFactory;
}

/** Bumped per open of a context without a stable `selectionKey`. */
let openGeneration = 0;

export function WhisperDiffPanel({ state, workspaceRootPath, onClose, createDiffEditor }: WhisperDiffPanelProps) {
    const entries = useMemo(() => buildWhisperReviewEntries(state, workspaceRootPath), [state, workspaceRootPath]);
    const byPath = useMemo(() => new Map(entries.map(entry => [entry.file.path, entry])), [entries]);
    const files = useMemo(() => entries.map(entry => entry.file), [entries]);
    const focused = state.focusPath === undefined ? null
        : entries.find(entry => entry.sourcePath === state.focusPath)?.file.path ?? null;

    // A frozen context resets per open; a live one only when its key changes.
    const resetToken = state.selectionKey ?? state;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const generation = useMemo(() => ++openGeneration, [resetToken]);
    const identity = JSON.stringify([
        state.workspaceId ?? null,
        state.selectionKey ?? `${whisperReviewContentKey(entries)}#${generation}`,
    ]);

    return (
        <div className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]" data-testid="whisper-diff-panel">
            <ReviewFiles
                key={identity}
                identity={identity}
                defaultView="tree"
                files={files}
                selectedPath={focused}
                header={{
                    identity: <span className="git-review-muted" data-testid="whisper-diff-totals">{combinedTotalsLabel(state.view)}</span>,
                    actions: [{ id: 'close', label: 'Close', icon: <span aria-hidden="true">✕</span>, onClick: onClose, testId: 'whisper-diff-close-btn' }],
                }}
                renderEmpty={<div className="git-review-empty" data-testid="whisper-diff-empty">{state.error || 'No file changes.'}</div>}
                renderFile={context => {
                    const entry = byPath.get(context.file.path);
                    return entry ? (
                        <WhisperFileDiff
                            key={`${entry.file.path}\u0000${entry.modelIdentity}`}
                            entry={entry}
                            context={context}
                            workspaceId={state.workspaceId ?? ''}
                            createDiffEditor={createDiffEditor}
                        />
                    ) : null;
                }}
            />
        </div>
    );
}

const NOTICE: Record<'deleted' | 'unavailable', string> = {
    deleted: 'A later command deleted this file. No diff was captured for it.',
    unavailable: 'This change recorded no line content, so no diff is available.',
};

function WhisperFileDiff({ entry, context, workspaceId, createDiffEditor }: {
    entry: WhisperReviewEntry;
    context: ReviewFileRenderContext;
    workspaceId: string;
    createDiffEditor?: DiffEditorFactory;
}) {
    const [engine, setEngine] = useDiffEngine();
    const [viewMode, setViewMode] = useDiffViewMode();
    const [attempt, setAttempt] = useState(0);
    const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
    const { content } = entry;
    const { name, directory } = reviewFileParts(entry.file.path);
    const hasDiff = content.kind === 'whole' || content.kind === 'patch';
    const editorFailed = failedAttempt === attempt;
    const showEditor = hasDiff && engine === 'monaco' && !editorFailed;

    return (
        <div className="flex flex-col flex-1 min-h-0 min-w-0" data-testid="whisper-diff-file" data-path={entry.file.path} data-content={content.kind}>
            <div className="flex items-center gap-2 px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="whisper-diff-file-header">
                <span className="flex min-w-0 flex-1 items-baseline gap-2 text-xs font-mono" title={entry.sourcePath}>
                    <strong className="truncate font-medium">{name}</strong>
                    <span className="truncate text-[10px] text-[#848484]">{directory}</span>
                </span>
                {hasDiff && <DiffEngineToggle engine={engine} onChange={setEngine} />}
                {showEditor && <DiffViewToggle mode={viewMode} onChange={setViewMode} />}
                {showEditor && <DiffWordWrapToggle />}
            </div>
            <div className={`flex-1 min-h-0 flex flex-col ${showEditor ? 'overflow-hidden' : 'overflow-auto px-1 py-1'}`} data-testid="whisper-diff-body">
                {hasDiff && engine === 'monaco' && editorFailed && (
                    <DiffEngineFallbackBanner reason="editorFailed" onRetry={() => setAttempt(value => value + 1)} />
                )}
                {content.kind === 'patch' && (
                    <div role="note" className="shrink-0 px-2 py-1 text-xs text-[#616161] dark:text-[#bbb]" data-testid="whisper-diff-patch-only">
                        Only the edited snippets were captured for this change, so the full file is not shown.
                    </div>
                )}
                {showEditor ? (
                    <div className="flex-1 min-h-0">
                        <MonacoFileDiffViewer
                            key={attempt}
                            workspaceId={workspaceId}
                            relativePath={entry.file.path}
                            stage="staged"
                            modelIdentity={entry.modelIdentity}
                            original={content.original}
                            modified={content.modified}
                            lineLabels={content.kind === 'patch' ? content.lineLabels : undefined}
                            viewMode={viewMode}
                            initialHunkTarget={context.target}
                            languageFeatures={false}
                            onEditorError={() => setFailedAttempt(attempt)}
                            createEditor={createDiffEditor}
                            data-testid="whisper-diff-editor"
                        />
                    </div>
                ) : hasDiff ? (
                    <UnifiedDiffViewer
                        diff={content.diff}
                        fileName={name}
                        showLineNumbers
                        hideFileHeaders
                        data-testid="whisper-diff-viewer"
                    />
                ) : (
                    <div className="git-review-empty" data-testid="whisper-diff-no-diff">{NOTICE[content.kind]}</div>
                )}
            </div>
        </div>
    );
}
