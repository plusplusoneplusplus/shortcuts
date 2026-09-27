import { useEffect, useState } from 'react';
import type { ExplorerBlobResponse } from '@plusplusoneplusplus/coc-client';
import { splitMatchText } from '../explorer/contentSearchMatchText';
import type { ContentSearchOverlayMatch } from './ContentSearchOverlay';

type PreviewState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; lines: string[] };

export type ContentSearchPreviewLoader = (
    match: ContentSearchOverlayMatch,
    signal: AbortSignal,
) => Promise<ExplorerBlobResponse>;

export function sourcePreviewLines(
    match: ContentSearchOverlayMatch,
    blob: ExplorerBlobResponse,
): PreviewState {
    if (blob.encoding !== 'utf-8' || blob.content.includes('\0')) {
        return { status: 'error', message: 'Source preview is unavailable for binary files.' };
    }
    const lines = blob.content.split(/\r\n|\n|\r/);
    const line = lines[match.line - 1];
    if (
        line === undefined || !Number.isInteger(match.line) || match.line < 1
        || !Number.isInteger(match.startColumn) || !Number.isInteger(match.endColumn)
        || match.startColumn < 0 || match.endColumn < match.startColumn
        || match.endColumn > line.length
        || (match.preview.length === 0 ? line.length !== 0 : !line.startsWith(match.preview))
    ) {
        return { status: 'error', message: 'This file changed since the search. Run the search again.' };
    }
    return { status: 'ready', lines };
}

interface ContentSearchSourcePreviewProps {
    match: ContentSearchOverlayMatch | null;
    load: ContentSearchPreviewLoader;
    onOpen: (match: ContentSearchOverlayMatch) => void;
}

export function ContentSearchSourcePreview({ match, load, onOpen }: ContentSearchSourcePreviewProps) {
    const [result, setResult] = useState<{ match: ContentSearchOverlayMatch; state: PreviewState } | null>(null);

    useEffect(() => {
        if (match === null) return;
        const controller = new AbortController();
        Promise.resolve().then(() => load(match, controller.signal))
            .then(blob => {
                if (!controller.signal.aborted) setResult({ match, state: sourcePreviewLines(match, blob) });
            })
            .catch((error: unknown) => {
                if (!controller.signal.aborted) {
                    const status = (error as { status?: unknown } | null)?.status;
                    setResult({
                        match,
                        state: {
                            status: 'error',
                            message: status === 404
                                ? 'This file is no longer available. Run the search again.'
                                : error instanceof Error && error.message.startsWith('The repository owner is offline.')
                                    ? 'The repository owner is offline. Reconnect it and try again.'
                                    : 'Could not load source. Check the repository connection and try again.',
                        },
                    });
                }
            });
        return () => controller.abort();
    }, [load, match]);

    if (match === null) {
        return <p className="p-4 text-sm text-[#616161] dark:text-[#a0a0a0]">Select a match to preview its source.</p>;
    }
    const preview = result?.match === match ? result.state : { status: 'loading' as const };
    const displayed = preview.status === 'ready' ? preview.lines : [];
    const from = Math.max(0, match.line - 5);
    const to = Math.min(displayed.length, match.line + 4);

    return (
        <>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs border-b border-[#e5e5e5] dark:border-[#3c3c3c]">
                <span className="min-w-0 break-all" title={match.path}>
                    {match.repoLabel || match.workspaceId} / {match.path} · Line {match.line}
                </span>
                <button
                    type="button"
                    data-content-search-action="open"
                    className="shrink-0 px-2 py-1 rounded border border-[#c8c8c8] dark:border-[#555555] text-[#005a9e] dark:text-[#75beff]"
                    onClick={() => onOpen(match)}
                >
                    Open file
                </button>
            </div>
            <div role="status" aria-live="polite" className="sr-only">
                {preview.status === 'loading' ? 'Loading source preview'
                    : preview.status === 'error' ? preview.message : 'Source preview ready'}
            </div>
            {preview.status === 'loading' && <p className="p-4 text-sm">Loading source preview…</p>}
            {preview.status === 'error' && (
                <p role="alert" className="p-4 text-sm text-[#a1260d] dark:text-[#f48771]">
                    {preview.message}
                </p>
            )}
            {preview.status === 'ready' && (
                <div data-testid="content-search-overlay-source" className="min-h-0 flex-1 overflow-auto bg-[#f8fafc] dark:bg-[#1e1e1e]">
                    <div className="w-max min-w-full py-2 text-xs leading-6 font-mono">
                        {displayed.slice(from, to).map((text, offset) => {
                            const lineNumber = from + offset + 1;
                            const hit = lineNumber === match.line;
                            const parts = hit ? splitMatchText({
                                text,
                                startColumn: match.startColumn,
                                endColumn: match.endColumn,
                            }) : null;
                            return (
                                <div key={lineNumber} className={hit
                                    ? 'bg-[#e7efff] dark:bg-[#293448] border-l-2 border-[#3165d7]'
                                    : 'border-l-2 border-transparent'}>
                                    <span className="inline-block w-12 pr-2 text-right select-none text-[#8290a4]">{lineNumber}</span>
                                    <span className="whitespace-pre">{parts ? (
                                        <>
                                            {parts.before}
                                            <mark className="bg-[#f9d77b] dark:bg-[#623315] text-inherit">{parts.hit}</mark>
                                            {parts.after}
                                        </>
                                    ) : text}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );
}
