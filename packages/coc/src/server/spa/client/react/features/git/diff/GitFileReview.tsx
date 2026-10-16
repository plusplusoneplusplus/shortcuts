import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GitFileChange } from '@plusplusoneplusplus/coc-client';
import { FileDiffPanel } from './FileDiffPanel';
import type { FileDiffPanelProps } from './FileDiffPanel';
import { STATUS_LABELS } from './FileTree';
import { filterReviewFiles, groupReviewFiles, reviewFileParts, reviewFileStatus, type ReviewFileKind } from './gitReviewFiles';
import './git-file-review.css';
import { useCloneBaseUrl } from '../../../repos/cloneRouting';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';

type Props = Pick<FileDiffPanelProps, 'workspaceId' | 'attachmentDestinationId' | 'source' | 'reviewChat' | 'getHunkClassification' | 'hunkActiveFilters' | 'onDiffEngineChange' | 'focusComment'> & {
    comparisonKey: string;
    files: GitFileChange[];
    selectedPath?: string | null;
    onSelect?: (path: string, target: 'first' | 'last') => void;
    initialHunkTarget?: 'first' | 'last';
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
    reviewedFiles?: ReadonlySet<string>;
    onToggleReviewed?: (path: string) => void;
    headerActions?: ReactNode;
};

/** The key makes every piece of transient review state owner + comparison scoped. */
export function GitFileReview(props: Props) {
    const endpoint = useCloneBaseUrl(props.source.routingTarget === null ? undefined : props.source.routingTarget ?? props.workspaceId);
    if (props.source.routingTarget && resolveCloneRoute(props.source.routingTarget).kind === 'unresolved-remote') {
        return <div role="alert" className="git-review-empty">Git review owner is unavailable</div>;
    }
    return <ReviewBody key={JSON.stringify([props.attachmentDestinationId ?? props.workspaceId, props.workspaceId, props.comparisonKey, endpoint])} {...props} />;
}
function ReviewBody({ files, selectedPath, onSelect, loading, error, onRetry, reviewedFiles, onToggleReviewed,
    comparisonKey: _comparisonKey, headerActions, initialHunkTarget, ...panel }: Props) {
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<ReviewFileKind>('all');
    const [status, setStatus] = useState('all');
    const [hideViewed, setHideViewed] = useState(false);
    const [localViewed, setLocalViewed] = useState<ReadonlySet<string>>(() => new Set());
    const viewed = reviewedFiles ?? localViewed;
    const [selection, setSelection] = useState<string | null>(selectedPath ?? null);
    const [target, setTarget] = useState<'first' | 'last'>(initialHunkTarget ?? 'first');
    const [overview, setOverview] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
    const drawerTrigger = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const navRef = useRef<HTMLElement>(null);
    const navId = useId();
    const visible = useMemo(() => filterReviewFiles(files, query, kind, status, hideViewed, viewed), [files, query, kind, status, hideViewed, viewed]);
    const groups = useMemo(() => groupReviewFiles(visible), [visible]);
    const ordered = useMemo(() => groups.flatMap(group => group.files), [groups]);
    const focusedSource = useMemo(() => ({ ...panel.source, files: ordered.map(file => file.path) }), [panel.source, ordered]);
    const selected = ordered.find(file => file.path === selection) ?? ordered[0];
    const index = selected ? ordered.indexOf(selected) : -1;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const viewedCount = files.filter(file => viewed.has(file.path)).length;
    useEffect(() => { if (selectedPath) {
        setSelection(selectedPath); setOverview(false); setTarget(initialHunkTarget ?? 'first');
        if (!visible.some(file => file.path === selectedPath)) clear();
        setCollapsed(previous => { const next = new Set(previous); next.delete(reviewFileParts(selectedPath).directory); return next; });
    } }, [selectedPath, initialHunkTarget]);
    useEffect(() => {
        if (!loading && !error && selected && !ordered.some(file => file.path === selection)) {
            setSelection(selected.path); setTarget('first'); onSelectRef.current?.(selected.path, 'first');
        }
    }, [selected?.path, selection, ordered, loading, error]);
    useEffect(() => {
        if (!drawer) return;
        const previous = document.activeElement as HTMLElement | null;
        searchRef.current?.focus();
        return () => { (drawerTrigger.current ?? previous)?.focus(); };
    }, [drawer]);
    useEffect(() => {
        const row = navRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
        row?.scrollIntoView?.({ block: 'nearest' });
    }, [selected?.path]);
    function select(path: string, hunk: 'first' | 'last' = 'first') {
        setSelection(path); setTarget(hunk); setOverview(false); setDrawer(false); onSelect?.(path, hunk);
    }
    function clear() { setQuery(''); setKind('all'); setStatus('all'); setHideViewed(false); }
    function toggleViewed(path: string) {
        if (onToggleReviewed) onToggleReviewed(path);
        else setLocalViewed(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
    }
    function row(file: GitFileChange, scan = false) {
        const { name, directory } = reviewFileParts(file.path);
        const code = reviewFileStatus(file.status);
        return <button type="button" key={file.path} className={`git-review-file${selected?.path === file.path && !scan ? ' selected' : ''}`}
            aria-current={selected?.path === file.path && !scan ? 'true' : undefined} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            aria-label={`${file.path}, ${STATUS_LABELS[code] ?? file.status}${viewed.has(file.path) ? ", viewed" : ""}`}
            onClick={() => select(file.path)} data-file-path={file.path}>
            <span className={`git-review-status status-${code}`} title={STATUS_LABELS[code] ?? file.status}>{code}</span>
            <span className="git-review-file-name"><strong>{name}</strong><small>{file.oldPath ? `${file.oldPath} → ${directory}` : directory}</small></span>
            <span className="git-review-counts"><span className="git-review-add">{file.additions == null ? '' : `+${file.additions}`}</span><span className="git-review-del">{file.deletions == null ? '' : `−${file.deletions}`}</span></span>
            {viewed.has(file.path) && <span aria-label="Viewed" className="git-review-add">✓</span>}
        </button>;
    }
    return <div className="git-file-review" data-testid="git-file-review">
        <div className="git-review-tools">
            <button type="button" className="git-review-drawer-trigger" ref={drawerTrigger} aria-expanded={drawer} aria-controls={navId} onClick={() => setDrawer(value => !value)}>Files · {files.length}</button>
            <button type="button" aria-pressed={overview} onClick={() => setOverview(value => !value)}>{overview ? 'Read diff' : 'Overview'}</button>
            <span className="git-review-muted">{selected && !overview ? `${index + 1} / ${ordered.length}` : `${visible.length} files`}</span>
            <button type="button" aria-label="Previous file" disabled={index <= 0} onClick={() => select(ordered[index - 1].path)}>←</button>
            <button type="button" aria-label="Next file" disabled={index < 0 || index >= ordered.length - 1} onClick={() => select(ordered[index + 1].path)}>→</button>
            {selected && !overview && <><span className="git-review-status" title={STATUS_LABELS[reviewFileStatus(selected.status)] ?? selected.status}>{reviewFileStatus(selected.status)}</span>
                <span className="git-review-counts"><span className="git-review-add">{selected.additions == null ? '' : `+${selected.additions}`}</span><span className="git-review-del">{selected.deletions == null ? '' : `−${selected.deletions}`}</span></span></>}
            <span className="git-review-spacer" />
            {selected && <button type="button" aria-pressed={viewed.has(selected.path)} onClick={() => toggleViewed(selected.path)}>{viewed.has(selected.path) ? '✓ Viewed' : 'Mark viewed'}</button>}
            {headerActions}
        </div>
        <div className="git-review-body">
            {drawer && <button type="button" className="git-review-scrim" aria-label="Close file navigator" onClick={() => setDrawer(false)} />}
            <aside id={navId} ref={navRef} className={`git-review-nav${drawer ? ' open' : ''}`} aria-label="Changed files"
                onKeyDown={event => {
                    if (event.key === 'Escape' && drawer) { event.preventDefault(); setDrawer(false); }
                    if (drawer && event.key === 'Tab') {
                        const controls = navRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select');
                        const first = controls?.[0], last = controls?.[controls.length - 1];
                        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                    }
                    if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute('data-file-path')) return;
                    const buttons = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>('[data-file-path]') ?? []);
                    const current = buttons.indexOf(event.target);
                    const next = event.key === 'ArrowDown' ? current + 1 : event.key === 'ArrowUp' ? current - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
                    if (next >= 0 && next < buttons.length) {
                        event.preventDefault();
                        const path = buttons[next].dataset.filePath!;
                        setSelection(path); setOverview(false); setTarget('first'); onSelect?.(path, 'first'); buttons[next].focus();
                    }
                }}>
                <div className="git-review-filters">
                    <div className="git-review-filter-title"><strong>Changed files · {files.length}</strong><button type="button" className="git-review-drawer-trigger" aria-label="Close file navigator" onClick={() => setDrawer(false)}>×</button></div>
                    <input ref={searchRef} aria-label="Search changed files by name or path" placeholder="Search files or path…" value={query} onChange={event => setQuery(event.target.value)} />
                    <div className="git-review-filter-row">{(['all', 'source', 'tests', 'docs'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All' : value === 'source' ? 'Source' : value === 'tests' ? 'Tests' : 'Docs'}</button>)}</div>
                    <div className="git-review-filter-row"><label><input type="checkbox" checked={hideViewed} onChange={event => setHideViewed(event.target.checked)} /> Hide viewed</label>
                        <select aria-label="Change status filter" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>{['A', 'M', 'D', 'R', 'C', 'T'].map(code => <option key={code} value={code}>{STATUS_LABELS[code] ?? code}</option>)}</select></div>
                </div>
                <div className="git-review-file-list">{groups.map(group => <section key={group.directory}>
                    <button type="button" className="git-review-directory" aria-label={`${group.directory} ${group.files.length} files`} aria-expanded={!collapsed.has(group.directory)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(group.directory)) next.delete(group.directory); else next.add(group.directory); return next; })}>
                        <span>{collapsed.has(group.directory) ? '▸' : '▾'}</span><span title={group.directory}>{group.directory}</span><small>{group.files.length}</small>
                    </button>{!collapsed.has(group.directory) && group.files.map(file => row(file))}
                </section>)}{!loading && !visible.length && <div className="git-review-empty">{files.length ? 'No matching files.' : 'No file changes.'}<button type="button" onClick={clear}>Clear filters</button></div>}</div>
                <div className="git-review-progress">{viewedCount} / {files.length} viewed · {visible.length} shown<progress aria-label="Files viewed" value={viewedCount} max={files.length || 1} /></div>
            </aside>
            <main className="git-review-content" aria-label="Focused file diff">
                {loading ? <div role="status" className="git-review-empty">Loading files…</div> : error ? <div role="alert" className="git-review-empty">{error}<button type="button" onClick={onRetry}>Retry</button></div> : overview ? <div className="git-review-overview">
                    <div className="git-review-overview-summary">{visible.length} files · {groups.length} directories · {viewedCount} viewed <span className="git-review-add">+{visible.reduce((sum, file) => sum + (file.additions ?? 0), 0)}</span> <span className="git-review-del">−{visible.reduce((sum, file) => sum + (file.deletions ?? 0), 0)}</span></div>
                    {groups.map(group => <section key={group.directory}><div className="git-review-directory">{group.directory} · {group.files.length}</div>{group.files.map(file => row(file, true))}</section>)}
                </div> : selected ? <FileDiffPanel {...panel} source={focusedSource} filePath={selected.path} onNavigateToFile={select} initialHunkTarget={target} showSourceLabel={false} showChatToggle={!panel.reviewChat} />
                    : <div className="git-review-empty">{files.length ? 'No matching files.' : 'No file changes.'}{!!files.length && <button type="button" onClick={clear}>Clear filters</button>}</div>}
            </main>
        </div>
    </div>;
}
