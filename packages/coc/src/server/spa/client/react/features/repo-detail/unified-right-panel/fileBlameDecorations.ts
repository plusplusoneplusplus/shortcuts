/**
 * fileBlameDecorations — paints a file's `HEAD` blame into a Monaco editor
 * (`features.fileBlame`).
 *
 * Every buffer line gets a fixed-width label injected before its text, so the
 * code stays aligned: the first line of a run names its commit (author and
 * date) or "Not committed yet", the rest of the run is blank. Hovering a line
 * shows the full subject, author and date. Clicking an attributed label hands
 * its commit hash to the host. The mapping is recomputed on every buffer edit,
 * so changed lines turn "Not committed yet" instead of keeping a stale commit.
 */

import type { editor as monacoEditor, IMarkdownString } from 'monaco-editor';
import type { GitFileBlameCommit, GitFileBlameResponse } from '@plusplusoneplusplus/coc-client';
import type { EditorModelMountContext } from '../../../shared/file-viewer/MonacoFileEditor';
import { NOT_COMMITTED_LABEL, blameRuns, mapBlameToBuffer, splitBufferLines } from './fileBlameModel';

/** CSS class on the injected gutter label (styled in tailwind.css). */
export const FILE_BLAME_LABEL_CLASS = 'file-blame-label';
/** Extra class on labels of lines that are not committed yet. */
export const FILE_BLAME_UNCOMMITTED_CLASS = 'file-blame-uncommitted';

const AUTHOR_WIDTH = 12;
/** Characters every injected label occupies, separator included. */
export const FILE_BLAME_LABEL_WIDTH = AUTHOR_WIDTH + 1 + 10 + 2;

function fit(text: string, width: number): string {
    return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

function formatDay(date: string): string {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

/** The compact label shown on the first line of a run. */
export function formatBlameLabel(commit: GitFileBlameCommit | null): string {
    const text = commit ? `${fit(commit.author, AUTHOR_WIDTH)} ${formatDay(commit.date)}` : NOT_COMMITTED_LABEL;
    return fit(text, FILE_BLAME_LABEL_WIDTH - 2).padEnd(FILE_BLAME_LABEL_WIDTH);
}

function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, '\\$&');
}

/** The hover shown for every line of a run. */
export function formatBlameHover(commit: GitFileBlameCommit | null): IMarkdownString {
    if (!commit) return { value: escapeMarkdown(NOT_COMMITTED_LABEL) };
    const date = new Date(commit.date);
    const when = Number.isNaN(date.getTime()) ? commit.date : date.toLocaleString();
    return {
        value: [
            `**${escapeMarkdown(commit.subject)}**`,
            `${escapeMarkdown(commit.author)} · ${escapeMarkdown(when)}`,
            `\`${commit.shortHash}\``,
        ].join('\n\n'),
    };
}

/** Builds one decoration per buffer line for the given blame and buffer text. */
export function buildBlameDecorations(
    blame: GitFileBlameResponse,
    text: string,
    cursorStopsNone: monacoEditor.InjectedTextCursorStops,
): monacoEditor.IModelDeltaDecoration[] {
    const blank = ' '.repeat(FILE_BLAME_LABEL_WIDTH);
    const decorations: monacoEditor.IModelDeltaDecoration[] = [];
    for (const run of blameRuns(mapBlameToBuffer(blame.lines, splitBufferLines(text)))) {
        const commit = run.hash ? blame.commits[run.hash] ?? null : null;
        const hoverMessage = formatBlameHover(commit);
        const inlineClassName = commit ? FILE_BLAME_LABEL_CLASS : `${FILE_BLAME_LABEL_CLASS} ${FILE_BLAME_UNCOMMITTED_CLASS}`;
        for (let line = run.startLine; line <= run.endLine; line++) {
            decorations.push({
                range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
                options: {
                    description: 'file-blame',
                    // Monaco drops injected text on an empty range without this.
                    showIfCollapsed: true,
                    hoverMessage,
                    before: {
                        content: line === run.startLine ? formatBlameLabel(commit) : blank,
                        inlineClassName,
                        cursorStops: cursorStopsNone,
                        ...(commit ? { attachedData: commit.hash } : {}),
                    },
                },
            });
        }
    }
    return decorations;
}

/**
 * Attaches blame decorations to a mounted editor and returns their cleanup.
 * `onOpenCommit` receives the hash of a clicked attributed label.
 */
export function attachFileBlameDecorations(
    { editor, monaco, model }: Pick<EditorModelMountContext, 'editor' | 'monaco' | 'model'>,
    blame: GitFileBlameResponse,
    onOpenCommit: (hash: string) => void,
): () => void {
    const cursorStopsNone = monaco.editor.InjectedTextCursorStops.None;
    const collection = editor.createDecorationsCollection(buildBlameDecorations(blame, model.getValue(), cursorStopsNone));
    const change = model.onDidChangeContent(() => {
        collection.set(buildBlameDecorations(blame, model.getValue(), cursorStopsNone));
    });
    const click = editor.onMouseDown(event => {
        if (event.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return;
        const hash = event.target.detail?.injectedText?.options.attachedData;
        if (typeof hash === 'string' && blame.commits[hash]) onOpenCommit(hash);
    });
    return () => {
        click.dispose();
        change.dispose();
        collection.clear();
    };
}
