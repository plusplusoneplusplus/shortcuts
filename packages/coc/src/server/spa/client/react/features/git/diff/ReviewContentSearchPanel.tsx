import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { SearchBar } from '../../repo-detail/explorer/SearchBar';
import { DEFAULT_CONTENT_SEARCH_MODES, type ContentSearchModes } from '../../repo-detail/explorer/types';
import type { ReviewContentMatch, ReviewSearchSideFilter } from './reviewContentSearch';
import type { ReviewContentSearchController, ReviewSearchFile } from './reviewContentSearchController';
import { compileReviewContentInclude } from './reviewContentSearchGlob';
import { REVIEW_SEARCH_STEP_EVENT } from './useReviewContentSearchShortcut';

export interface ReviewContentSearchPanelProps {
    /** The host owns and disposes this controller, and keys the panel by review identity. */
    controller: ReviewContentSearchController;
    onOpenMatch: (file: ReviewSearchFile, match: ReviewContentMatch) => void;
    inputRef?: RefObject<HTMLInputElement>;
}

const FIELD_CLASS = 'w-full min-w-0 rounded border border-[#e0e0e0] bg-white px-2 py-1 dark:border-[#3c3c3c] dark:bg-[#3c3c3c]';

/** Limit only the displayed context, never the searchable contents or match count. */
function MatchSnippet({ match }: { match: ReviewContentMatch }) {
    const start = match.startColumn - 1;
    const end = match.endColumn - 1;
    const from = Math.max(0, start - 60);
    const to = Math.min(match.text.length, end + 100);
    return (
        <span className="whitespace-pre font-mono" title={match.text}>
            {from > 0 && '…'}{match.text.slice(from, start)}
            <mark className="bg-[#ffdf80] text-black dark:bg-[#806000] dark:text-white">
                {match.text.slice(start, end) || '▏'}
            </mark>
            {match.text.slice(end, to)}{to < match.text.length && '…'}
        </span>
    );
}

/** Review-local controls and results. The loader and navigation stay host-owned. */
export function ReviewContentSearchPanel({ controller, onOpenMatch, inputRef }: ReviewContentSearchPanelProps) {
    useEffect(() => () => controller.stop(), [controller]);
    const [query, setQuery] = useState('');
    const [modes, setModes] = useState<ContentSearchModes>(DEFAULT_CONTENT_SEARCH_MODES);
    const [side, setSide] = useState<ReviewSearchSideFilter>('both');
    const [include, setInclude] = useState('');
    const sectionRef = useRef<HTMLElement>(null);
    const [active, setActive] = useState<string | null>(null);
    useEffect(() => setActive(null), [controller, query, modes, side, include]);
    const compiledInclude = useMemo(() => compileReviewContentInclude(include), [include]);
    const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

    useEffect(() => {
        if (compiledInclude.error !== null) {
            controller.start('', modes);
        } else {
            controller.start(query, modes, side, file => compiledInclude.includes(file.path));
        }
    }, [controller, query, modes, side, compiledInclude]);

    const matched = snapshot.files.filter(entry => entry.matches.length > 0);
    const skipped = snapshot.files.filter(entry => entry.state.status === 'skipped');
    const errors = snapshot.files.filter(entry => entry.state.status === 'error');
    const count = matched.reduce((total, entry) => total + entry.matches.length, 0);
    const valid = query.length > 0 && !snapshot.error && compiledInclude.error === null;
    const toggle = (key: keyof ContentSearchModes) => setModes(current => ({ ...current, [key]: !current[key] }));
    const matchKey = (file: ReviewSearchFile, match: ReviewContentMatch) =>
        JSON.stringify([file.id, match.side, match.line, match.startColumn, match.endColumn]);
    const activate = (file: ReviewSearchFile, match: ReviewContentMatch) => {
        setActive(matchKey(file, match));
        onOpenMatch(file, match);
    };
    useEffect(() => {
        const root = sectionRef.current?.closest('[data-review-content-search="true"]');
        if (!root) return;
        const step = (event: Event) => {
            if (!valid || count === 0 || !(event instanceof CustomEvent)) return;
            const matches = matched.flatMap(entry => entry.matches.map(match => ({ file: entry.file, match })));
            const index = matches.findIndex(item => matchKey(item.file, item.match) === active);
            const nextIndex = index < 0 ? (event.detail ? matches.length - 1 : 0)
                : (index + (event.detail ? -1 : 1) + matches.length) % matches.length;
            event.preventDefault();
            const next = matches[nextIndex];
            activate(next.file, next.match);
        };
        root.addEventListener(REVIEW_SEARCH_STEP_EVENT, step);
        return () => root.removeEventListener(REVIEW_SEARCH_STEP_EVENT, step);
    }, [valid, count, snapshot, active, onOpenMatch]);
    useEffect(() => {
        const row = sectionRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
        const group = row?.closest('details');
        if (group) group.open = true;
        if (!sectionRef.current?.closest('[hidden]')) row?.scrollIntoView?.({ block: 'nearest' });
    }, [active]);

    return (
        <section ref={sectionRef} aria-label="Review content search" className="flex min-h-0 flex-1 flex-col text-xs text-[#1e1e1e] dark:text-[#cccccc]">
            <SearchBar
                value={query}
                onChange={setQuery}
                onClear={() => setQuery('')}
                inputRef={inputRef}
                placeholder="Search changed file contents…"
                testIdPrefix="review-content-search"
                togglePlacement="below"
                toggles={[
                    { id: 'case', label: 'Aa', title: 'Match case', active: modes.caseSensitive, onToggle: () => toggle('caseSensitive') },
                    { id: 'word', label: 'ab', title: 'Whole word', active: modes.wholeWord, onToggle: () => toggle('wholeWord') },
                    { id: 'regex', label: '.*', title: 'Regex', active: modes.regex, onToggle: () => toggle('regex') },
                ]}
                onSubmit={() => {
                    const first = matched[0];
                    if (valid && first) activate(first.file, first.matches[0]);
                }}
            />
            {snapshot.error && <p role="alert" className="px-2 text-[#c72e0f]">{snapshot.error}</p>}
            <div className="space-y-1 px-2 pb-2">
                <label className="flex items-center gap-2">
                    Side
                    <select aria-label="Search side" value={side} onChange={event => setSide(event.target.value as ReviewSearchSideFilter)} className={FIELD_CLASS}>
                        <option value="both">Both</option><option value="old">Old</option><option value="new">New</option>
                    </select>
                </label>
                <label className="block">
                    Files to include
                    <input aria-label="Files to include" placeholder="e.g. src/**, *.ts" value={include} onChange={event => setInclude(event.target.value)} className={FIELD_CLASS} />
                </label>
                {compiledInclude.error && <p role="alert" className="text-[#c72e0f]">{compiledInclude.error}</p>}
            </div>
            {valid ? (
                <div className="flex flex-wrap items-center gap-2 px-2 pb-2" role="status">
                    <span>Searched {snapshot.searched} of {snapshot.total} files</span>
                    <span>{count} {count === 1 ? 'match' : 'matches'}</span>
                    {snapshot.running && <button type="button" onClick={() => controller.stop()} className="underline">Stop</button>}
                </div>
            ) : !query && <p className="px-2 py-1">Search the old and new contents of changed files.</p>}
            <div className="min-h-0 flex-1 overflow-auto">
                {valid && matched.map(entry => (
                    <details key={entry.file.id} open className="border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <summary className="cursor-pointer break-all px-2 py-1 font-medium">{entry.file.path} ({entry.matches.length})</summary>
                        {entry.matches.map((match, index) => (
                            <button
                                type="button"
                                key={`${match.side}:${match.line}:${match.startColumn}:${index}`}
                                onClick={() => activate(entry.file, match)}
                                aria-current={active === matchKey(entry.file, match) ? 'true' : undefined}
                                aria-label={`${entry.file.path}, ${match.side.toUpperCase()} line ${match.line}, column ${match.startColumn}`}
                                className="flex w-full items-baseline gap-2 overflow-hidden px-2 py-1 text-left hover:bg-[#e8e8e8] focus:bg-[#e8e8e8] dark:hover:bg-[#37373d] dark:focus:bg-[#37373d]"
                            >
                                <span className="shrink-0 rounded border px-1 text-[10px]">{match.side.toUpperCase()}</span>
                                <span className="shrink-0 text-[#848484]">{match.line}</span>
                                <MatchSnippet match={match} />
                            </button>
                        ))}
                    </details>
                ))}
                {valid && !snapshot.running && count === 0 && <p className="px-2 py-1">No matches.</p>}
                {valid && skipped.length > 0 && (
                    <section aria-label="Skipped" className="px-2 py-1">
                        <h3 className="font-medium">Skipped ({skipped.length})</h3>
                        {skipped.map(entry => <p key={entry.file.id} className="break-all">
                            {entry.file.path}: {entry.state.status === 'skipped' && (entry.state.reason === 'binary' ? 'Binary file' : 'Over server size limit (10 MB)')}
                        </p>)}
                    </section>
                )}
                {valid && errors.length > 0 && (
                    <section aria-label="Errors" className="px-2 py-1">
                        <h3 className="font-medium">Errors ({errors.length})</h3>
                        {errors.map(entry => <div key={entry.file.id} className="break-all">
                            <p>{entry.file.path}: {entry.state.status === 'error' && entry.state.message}</p>
                            <button type="button" aria-label={`Retry ${entry.file.path}`} onClick={() => controller.retry(entry.file.id)} className="underline">Retry</button>
                        </div>)}
                    </section>
                )}
            </div>
        </section>
    );
}
