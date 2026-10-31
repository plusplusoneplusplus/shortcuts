import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useReviewFileNavigation } from './useReviewFileNavigation';
import { STATUS_LABELS, type FileChange } from './FileTree';
import { filterReviewFiles, groupReviewFiles, reviewFileKey, reviewFileKind, reviewFileParts, reviewFileStatus, type ReviewFileKind } from './gitReviewFiles';
import { GitReviewToolbar, type GitReviewHeader } from './GitReviewToolbar';
import { useResizablePanel } from '../../../hooks/ui/useResizablePanel';
import { writePointerContextDragData } from '../../chat/sessionContextDrag';
import type { GitFileContextDragPayload } from '../../chat/sessionContextDrag';
import { buildFileTree, type FileTreeNode } from './reviewFileTree';
import { ContextMenu, type ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { ReviewContentSearchPanel, type ReviewContentSearchPanelProps } from './ReviewContentSearchPanel';
import { useDiffContentSearchEnabled } from '../../../hooks/feature-flags/useDiffContentSearchEnabled';
import './git-file-review.css';

export const NAV_DEFAULT_WIDTH = 262, NAV_MIN_WIDTH = 180, NAV_MAX_WIDTH = 560, NAV_CONTENT_MIN = 320, NAV_KEY_STEP = 16;
export const NAV_WIDTH_STORAGE_KEY = 'git-review-nav-width';

/** Metadata common to local Git and provider-backed PR files. No transport or revision assumptions. */
export type ReviewFile = FileChange;
export interface ReviewFileRenderContext {
    file: ReviewFile;
    paths: string[];
    select: (path: string, target?: 'first' | 'last') => void;
    target: 'first' | 'last';
    toggleViewed: () => void;
}
export interface ReviewRowMenuAnchor { x: number; y: number; row: HTMLElement }

export interface ReviewFilesProps {
    /** Hosts key this component by the complete owner and comparison identity. */
    identity: string;
    /** Hosts own/dispose the controller and replace it on owner, comparison or refresh changes.
     * Omit for surfaces such as chat diffs that do not support full-content review search. */
    contentSearch?: Omit<ReviewContentSearchPanelProps, 'inputRef'>;
    /** Mutable comparisons can guard navigation while an editor holds unsaved text. */
    beforeNavigate?: (proceed: () => void) => void;
    retainSelection?: boolean;
    /** Mutable changes do not have persisted review progress. */
    reviewEnabled?: boolean;
    defaultView?: 'groups' | 'tree' | 'flat';
    files: ReviewFile[];
    selectedPath?: string | null;
    onSelect?: (path: string, target: 'first' | 'last') => void;
    initialHunkTarget?: 'first' | 'last';
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
    reviewedFiles?: ReadonlySet<string>;
    onToggleReviewed?: (path: string) => void | Promise<void>;
    header?: GitReviewHeader;
    renderFile: (context: ReviewFileRenderContext) => ReactNode;
    renderEmpty?: ReactNode;
    rowDetails?: (file: ReviewFile) => ReactNode;
    rowDrag?: (file: ReviewFile) => GitFileContextDragPayload | null;
    /**
     * Right-click (or Menu key / Shift+F10) actions for the clicked row; selection is unchanged.
     * `anchor` is where the menu opens and the row to return focus to.
     */
    rowMenu?: (file: ReviewFile, anchor: ReviewRowMenuAnchor) => ContextMenuItem[];
    isFileDimmed?: (path: string) => boolean;
}

export function ReviewFiles({ files, selectedPath, onSelect, loading, error, onRetry, reviewedFiles, onToggleReviewed,
    identity, contentSearch, beforeNavigate, retainSelection = false, reviewEnabled = true, defaultView = 'groups', header, initialHunkTarget, renderFile, renderEmpty, rowDetails, rowDrag, rowMenu, isFileDimmed }: ReviewFilesProps) {
    const contentSearchEnabled = useDiffContentSearchEnabled();
    const canSearch = contentSearchEnabled && !!contentSearch;
    const [navigatorMode, setNavigatorMode] = useState<'files' | 'search'>('files');
    const searching = canSearch && navigatorMode === 'search';
    const contentSearchRef = useRef<HTMLInputElement>(null);
    useEffect(() => { if (!canSearch) setNavigatorMode('files'); }, [canSearch]);
    useEffect(() => { if (searching) contentSearchRef.current?.focus(); }, [searching]);
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<ReviewFileKind>('all');
    const [status, setStatus] = useState('all');
    const [hideViewed, setHideViewed] = useState(false);
    const [localViewed, setLocalViewed] = useState<ReadonlySet<string>>(() => new Set());
    const viewed = reviewedFiles ?? localViewed;
    const [retainedPath, setRetainedPath] = useState<string | null>(null);
    const [selection, setSelection] = useState<string | null>(selectedPath ?? null);
    const [target, setTarget] = useState<'first' | 'last'>(initialHunkTarget ?? 'first');
    const [overview, setOverview] = useState(false);
    const [drawer, setDrawer] = useState(false);
    const [viewMode, setViewMode] = useState<'groups' | 'tree' | 'flat'>(defaultView);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
    const [menu, setMenu] = useState<{ items: ContextMenuItem[]; x: number; y: number; row: HTMLElement; keyboard: boolean } | null>(null);
    const drawerTrigger = useRef<HTMLButtonElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const navRef = useRef<HTMLElement>(null);
    const navId = useId();
    const bodyRef = useRef<HTMLDivElement>(null);
    const [bodyWidth, setBodyWidth] = useState(0);
    useEffect(() => {
        const body = bodyRef.current;
        if (!body || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => setBodyWidth(entry.contentRect.width));
        observer.observe(body);
        return () => observer.disconnect();
    }, []);
    // The container bounds the persisted preference without overwriting it, so it returns when the pane widens.
    const navMax = bodyWidth > 0 ? Math.max(NAV_MIN_WIDTH, Math.min(NAV_MAX_WIDTH, bodyWidth - NAV_CONTENT_MIN)) : NAV_MAX_WIDTH;
    const navSize = useResizablePanel({ initialWidth: NAV_DEFAULT_WIDTH, minWidth: NAV_MIN_WIDTH, maxWidth: navMax, storageKey: NAV_WIDTH_STORAGE_KEY });
    const navWidth = Math.min(navSize.width, navMax);
    function resizeNav(event: KeyboardEvent) {
        const step = event.shiftKey ? NAV_KEY_STEP * 4 : NAV_KEY_STEP;
        const next = event.key === 'ArrowLeft' ? navWidth - step : event.key === 'ArrowRight' ? navWidth + step
            : event.key === 'Home' ? NAV_MIN_WIDTH : event.key === 'End' ? navMax : null;
        if (next === null) return;
        event.preventDefault(); navSize.setSize(next);
    }
    // Category totals describe the whole comparison, independently of every navigator filter.
    const kindCounts = useMemo(() => {
        const counts = { all: files.length, source: 0, tests: 0, docs: 0 };
        for (const file of files) counts[reviewFileKind(file.path)]++;
        return counts;
    }, [files]);
    const visible = useMemo(() => filterReviewFiles(files, query, kind, status, hideViewed, viewed), [files, query, kind, status, hideViewed, viewed]);
    const groups = useMemo(() => groupReviewFiles(visible), [visible]);
    const tree = useMemo(() => buildFileTree(visible), [visible]);
    const ordered = useMemo(() => {
        function flatten(nodes: FileTreeNode[]): ReviewFile[] {
            return nodes.flatMap(node => node.kind === 'folder' ? flatten(node.children) : [node.file]);
        }
        return viewMode === 'flat' ? visible : viewMode === 'tree' ? flatten(tree) : groups.flatMap(group => group.files);
    }, [groups, visible, viewMode, tree]);
    const paths = useMemo(() => ordered.map(reviewFileKey), [ordered]);
    const selected = (retainSelection ? files.find(file => reviewFileKey(file) === selection) : undefined) ?? ordered.find(file => reviewFileKey(file) === selection)
        ?? (hideViewed && selection && selection === retainedPath && viewed.has(selection)
            ? filterReviewFiles(files, query, kind, status, false, viewed).find(file => reviewFileKey(file) === selection) : undefined)
        ?? ordered[0];
    const index = selected ? ordered.indexOf(selected) : -1;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const viewedCount = files.filter(file => viewed.has(reviewFileKey(file))).length;
    useEffect(() => { if (selectedPath) {
        setSelection(selectedPath); setOverview(false); setTarget(initialHunkTarget ?? 'first');
        if (!visible.some(file => reviewFileKey(file) === selectedPath)) clear();
        setCollapsed(previous => new Set([...previous].filter(directory => !selectedPath.startsWith(`${directory}/`))));
    } }, [selectedPath, initialHunkTarget]);
    useEffect(() => {
        if (!loading && !error && selected && reviewFileKey(selected) !== selection) {
            setSelection(reviewFileKey(selected)); setTarget('first'); onSelectRef.current?.(reviewFileKey(selected), 'first');
        }
    }, [selected && reviewFileKey(selected), selection, ordered, loading, error]);
    useEffect(() => {
        if (!drawer) return;
        const previous = document.activeElement as HTMLElement | null;
        (searching ? contentSearchRef : searchRef).current?.focus();
        return () => { (drawerTrigger.current ?? previous)?.focus(); };
    }, [drawer]);
    useEffect(() => {
        const row = navRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
        row?.scrollIntoView?.({ block: 'nearest' });
    }, [selected && reviewFileKey(selected)]);
    function select(path: string, hunk: 'first' | 'last' = 'first', closeDrawer = true) {
        const proceed = () => { setSelection(path); setTarget(hunk); setOverview(false); if (closeDrawer) setDrawer(false); onSelect?.(path, hunk); };
        if (beforeNavigate) beforeNavigate(proceed); else proceed();
    }
    function clear() { setQuery(''); setKind('all'); setStatus('all'); setHideViewed(false); }
    const openContentMatch: ReviewContentSearchPanelProps['onOpenMatch'] = (file, match) => {
        const proceed = () => {
            clear();
            setSelection(file.id); setTarget('first'); setOverview(false); setDrawer(false);
            onSelect?.(file.id, 'first');
            contentSearch?.onOpenMatch(file, match);
        };
        if (beforeNavigate) beforeNavigate(proceed); else proceed();
    };
    function updateViewed(path: string) {
        if (hideViewed && path === (selected && reviewFileKey(selected)) && !viewed.has(path) && index === ordered.length - 1) setRetainedPath(path);
        if (onToggleReviewed) return onToggleReviewed(path);
        else setLocalViewed(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; });
    }
    const toggleViewed = useReviewFileNavigation({
        identity, selectedPath: overview || !selected ? null : reviewFileKey(selected),
        paths, reviewedFiles: viewed, toggleReviewed: updateViewed,
        navigate: select,
    });
    function row(file: ReviewFile, scan = false) {
        const { name, directory } = reviewFileParts(file.path);
        const code = reviewFileStatus(file.status);
        const payload = rowDrag?.(file);
        return <button type="button" key={reviewFileKey(file)} className={`git-review-file${(selected && reviewFileKey(selected)) === reviewFileKey(file) && !scan ? ' selected' : ''}`}
            style={isFileDimmed?.(file.path) ? { opacity: 0.4 } : undefined}
            aria-current={(selected && reviewFileKey(selected)) === reviewFileKey(file) && !scan ? 'true' : undefined} title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
            aria-label={`${file.path}${file.label ? `, ${file.label}` : ''}, ${STATUS_LABELS[code] ?? file.status}${viewed.has(reviewFileKey(file)) ? ", viewed" : ""}`}
            draggable={!!payload}
            data-session-context-source={payload ? 'true' : undefined}
            data-session-context-kind={payload ? 'git-file' : undefined}
            onDragStart={payload ? event => writePointerContextDragData(event.dataTransfer, payload) : undefined}
            onClick={() => select(reviewFileKey(file))} data-file-path={reviewFileKey(file)}
            aria-haspopup={rowMenu ? 'menu' : undefined}
            onContextMenu={rowMenu ? event => {
                event.preventDefault(); event.stopPropagation();
                // Keyboard-generated events carry no pointer position; anchor those to the row.
                openMenu(file, event.currentTarget, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null);
            } : undefined}
            onKeyDown={rowMenu ? event => {
                if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                event.preventDefault(); event.stopPropagation();
                openMenu(file, event.currentTarget, null);
            } : undefined}>
            <span className={`git-review-status status-${code}`} title={STATUS_LABELS[code] ?? file.status}>{code}</span>
            <span className="git-review-file-name"><strong>{name}</strong><small>{file.oldPath ? `${file.oldPath} → ${directory}` : directory}</small></span>
            <span className="git-review-counts"><span className="git-review-add">{file.additions == null ? '' : `+${file.additions}`}</span><span className="git-review-del">{file.deletions == null ? '' : `−${file.deletions}`}</span></span>
            {rowDetails?.(file)}
            {viewed.has(reviewFileKey(file)) && <span aria-label="Viewed" className="git-review-add">✓</span>}
        </button>;
    }
    function openMenu(file: ReviewFile, row: HTMLElement, at: { x: number; y: number } | null) {
        const rect = row.getBoundingClientRect();
        const point = at ?? { x: rect.left, y: rect.bottom };
        const items = rowMenu?.(file, { ...point, row });
        if (!items?.length) return;
        setMenu({ items, row, keyboard: !at, ...point });
    }
    function closeMenu() {
        if (menu?.keyboard) menu.row.focus();
        setMenu(null);
    }
    // A keyboard-opened menu takes focus so arrows and Enter reach its items.
    useLayoutEffect(() => {
        if (menu?.keyboard) document.querySelector<HTMLElement>('[data-testid="context-menu"] [role="menuitem"]:not([disabled])')?.focus();
    }, [menu]);
    function toggleDirectory(directory: string) {
        setCollapsed(previous => { const next = new Set(previous); if (next.has(directory)) next.delete(directory); else next.add(directory); return next; });
    }
    function treeRows(nodes: FileTreeNode[], depth = 0): ReactNode {
        return nodes.map(node => node.kind === 'file' ? <div key={reviewFileKey(node.file)} style={{ paddingLeft: depth * 10 }}>{row(node.file)}</div>
            : <section key={node.path}>
                <button type="button" className="git-review-directory" style={{ paddingLeft: 7 + depth * 10 }}
                    aria-label={node.path} aria-expanded={!collapsed.has(node.path)} onClick={() => toggleDirectory(node.path)}>
                    <span>{collapsed.has(node.path) ? '▸' : '▾'}</span><span title={node.path}>{node.name}</span><small>{node.fileCount}</small>
                </button>{!collapsed.has(node.path) && treeRows(node.children, depth + 1)}
            </section>);
    }
    return <div className="git-file-review" data-testid="git-file-review">
        <GitReviewToolbar header={header} progress={reviewEnabled ? { viewed: viewedCount, total: files.length } : undefined}>
            <button type="button" className="git-review-drawer-trigger" ref={drawerTrigger} aria-expanded={drawer} aria-controls={navId} onClick={() => setDrawer(value => !value)}>Files · {files.length}</button>
            <button type="button" className="git-review-icon" aria-pressed={overview} aria-label={overview ? 'Read diff' : 'Overview'} title={overview ? 'Read diff' : 'Overview'} onClick={() => { const proceed = () => setOverview(value => !value); if (beforeNavigate) beforeNavigate(proceed); else proceed(); }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>
                <span className="git-review-wide">{overview ? 'Read diff' : 'Overview'}</span>
            </button>
            {canSearch && <button type="button" className="git-review-icon" aria-label="Search review contents" title="Search review contents"
                aria-pressed={searching} onClick={() => { setNavigatorMode('search'); setDrawer(true); contentSearchRef.current?.focus(); }}>
                <span aria-hidden="true">⌕</span><span className="git-review-wide">Search</span>
            </button>}
            <div className="git-review-file-nav" role="group" aria-label="File navigation">
                <button type="button" aria-label="Previous file" title="Previous file" disabled={index <= 0} onClick={() => select(reviewFileKey(ordered[index - 1]))}>←</button>
                <span className="git-review-muted" title={selected && !overview ? selected.path : undefined} data-testid="git-review-file-index">{selected && !overview ? `${index + 1}/${ordered.length}` : `${visible.length} files`}</span>
                <button type="button" aria-label="Next file" title="Next file" disabled={index < 0 || index >= ordered.length - 1} onClick={() => select(reviewFileKey(ordered[index + 1]))}>→</button>
            </div>
            {selected && !overview && <span className="git-review-change git-review-md" data-testid="git-review-change-stats"
                title={`${STATUS_LABELS[reviewFileStatus(selected.status)] ?? selected.status} · ${selected.additions ?? 0} additions, ${selected.deletions ?? 0} deletions`}>
                <span className="git-review-status">{reviewFileStatus(selected.status)}</span>
                <span className="git-review-counts"><span className="git-review-add">{selected.additions == null ? '' : `+${selected.additions}`}</span><span className="git-review-del">{selected.deletions == null ? '' : `−${selected.deletions}`}</span></span></span>}
            <span className="git-review-spacer" />
            {reviewEnabled && files.length > 0 && <span className="git-review-muted git-review-md git-review-reviewed" title={`${viewedCount} of ${files.length} files reviewed`} data-testid="git-review-reviewed-count">
                {viewedCount}/{files.length}<span className="git-review-wide"> reviewed</span></span>}
            {reviewEnabled && selected && <button type="button" className="git-review-viewed" aria-pressed={viewed.has(reviewFileKey(selected))} aria-label={viewed.has(reviewFileKey(selected)) ? 'Viewed' : 'Mark viewed'}
                title={viewed.has(reviewFileKey(selected)) ? 'Viewed — click to unmark' : 'Mark viewed'} onClick={() => toggleViewed(reviewFileKey(selected))}>
                <span aria-hidden="true">{viewed.has(reviewFileKey(selected)) ? '✓' : '○'}</span><span className="git-review-label-sm">{viewed.has(reviewFileKey(selected)) ? 'Viewed' : 'Mark viewed'}</span>
            </button>}
        </GitReviewToolbar>
        <div className="git-review-body" ref={bodyRef} style={{ '--git-review-nav-width': `${navWidth}px` } as CSSProperties}>
            {drawer && <button type="button" className="git-review-scrim" aria-label="Close file navigator" onClick={() => setDrawer(false)} />}
            <aside id={navId} ref={navRef} className={`git-review-nav${drawer ? ' open' : ''}`} aria-label="Changed files"
                onKeyDown={event => {
                    // Menu items portal to the body but bubble here through React.
                    if (menu) return;
                    if (event.key === 'Escape' && drawer) { event.preventDefault(); setDrawer(false); }
                    if (drawer && event.key === 'Tab') {
                        const controls = Array.from(navRef.current?.querySelectorAll<HTMLElement>('button, input, select, summary') ?? [])
                            .filter(control => {
                                const details = control.closest('details');
                                return !control.closest('[hidden]') && !control.matches(':disabled')
                                    && (!details || details.open || control.tagName === 'SUMMARY');
                            });
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
                        select(path, 'first', false); buttons[next].focus();
                    }
                }}>
                {canSearch && <div className="git-review-filter-row" role="group" aria-label="Review navigator">
                    <button type="button" aria-pressed={!searching} onClick={() => setNavigatorMode('files')}>Files</button>
                    <button type="button" aria-pressed={searching} onClick={() => setNavigatorMode('search')}>Search</button>
                    {searching && <button type="button" className="git-review-drawer-trigger" aria-label="Close search navigator" onClick={() => setDrawer(false)}>×</button>}
                </div>}
                {canSearch && <div hidden={!searching} style={{ display: searching ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
                    <ReviewContentSearchPanel key={identity} {...contentSearch!} onOpenMatch={openContentMatch} inputRef={contentSearchRef} />
                </div>}
                <div hidden={searching} style={{ display: searching ? 'none' : 'contents' }}>
                <div className="git-review-filters">
                    <div className="git-review-filter-title"><strong>Changed files</strong><button type="button" className="git-review-drawer-trigger" aria-label="Close file navigator" onClick={() => setDrawer(false)}>×</button></div>
                    <div className="git-review-filter-row" role="group" aria-label="File list view">
                        <button type="button" aria-pressed={viewMode === 'groups'} onClick={() => setViewMode('groups')}>Groups</button>
                        <button type="button" aria-pressed={viewMode === 'tree'} onClick={() => setViewMode('tree')}>Tree</button>
                        <button type="button" aria-pressed={viewMode === 'flat'} onClick={() => setViewMode('flat')}>Flat</button>
                    </div>
                    <input ref={searchRef} aria-label="Search changed files by name or path" placeholder="Search files or path…" value={query} onChange={event => setQuery(event.target.value)} />
                    <div className="git-review-filter-row">{(['all', 'source', 'tests', 'docs'] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All' : value === 'source' ? 'Source' : value === 'tests' ? 'Tests' : 'Docs'} <span className="git-review-muted">{kindCounts[value]}</span></button>)}</div>
                    <div className="git-review-filter-row">{reviewEnabled && <label><input type="checkbox" checked={hideViewed} onChange={event => setHideViewed(event.target.checked)} /> Hide viewed</label>}
                        <select aria-label="Change status filter" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>{['A', 'M', 'D', 'R', 'C', 'T'].map(code => <option key={code} value={code}>{STATUS_LABELS[code] ?? code}</option>)}</select></div>
                </div>
                <div className="git-review-file-list">{viewMode === 'flat' ? visible.map(file => row(file)) : viewMode === 'tree' ? treeRows(tree) : groups.map(group => <section key={group.directory}>
                    <button type="button" className="git-review-directory" aria-label={`${group.directory} ${group.files.length} files`} aria-expanded={!collapsed.has(group.directory)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(group.directory)) next.delete(group.directory); else next.add(group.directory); return next; })}>
                        <span>{collapsed.has(group.directory) ? '▸' : '▾'}</span><span title={group.directory}>{group.directory}</span><small>{group.files.length}</small>
                    </button>{!collapsed.has(group.directory) && group.files.map(file => row(file))}
                </section>)}{!loading && !visible.length && <div className="git-review-empty">{files.length ? 'No matching files.' : 'No file changes.'}<button type="button" onClick={clear}>Clear filters</button></div>}</div>
                {reviewEnabled && <div className="git-review-progress">{viewedCount} / {files.length} viewed · {visible.length} shown<progress aria-label="Files viewed" value={viewedCount} max={files.length || 1} /></div>}
                </div>
            </aside>
            <div className={`git-review-resizer${navSize.isDragging ? ' dragging' : ''}`} role="separator" aria-orientation="vertical" tabIndex={0}
                aria-label="Resize changed files list" aria-controls={navId} aria-valuemin={NAV_MIN_WIDTH} aria-valuemax={navMax} aria-valuenow={navWidth}
                title="Drag to resize · double-click to reset" data-testid="git-review-resizer"
                onMouseDown={navSize.handleMouseDown} onTouchStart={navSize.handleTouchStart} onDoubleClick={navSize.resetWidth} onKeyDown={resizeNav} />
            {menu && <ContextMenu position={{ x: menu.x, y: menu.y }} items={menu.items} onClose={closeMenu} />}
            <main className="git-review-content" aria-label="Focused file diff">
                {loading ? <div role="status" className="git-review-empty">Loading files…</div> : error ? <div role="alert" className="git-review-empty">{error}<button type="button" onClick={onRetry}>Retry</button></div> : overview ? <div className="git-review-overview">
                    <div className="git-review-overview-summary">{visible.length} files · {groups.length} directories {reviewEnabled ? `· ${viewedCount} viewed` : ''} <span className="git-review-add">+{visible.reduce((sum, file) => sum + (file.additions ?? 0), 0)}</span> <span className="git-review-del">−{visible.reduce((sum, file) => sum + (file.deletions ?? 0), 0)}</span></div>
                    {groups.map(group => <section key={group.directory}><div className="git-review-directory">{group.directory} · {group.files.length}</div>{group.files.map(file => row(file, true))}</section>)}
                </div> : selected ? renderFile({ file: selected, paths, select, target,
                    toggleViewed: () => toggleViewed(reviewFileKey(selected)) })
                    : renderEmpty ?? <div className="git-review-empty">{files.length ? 'No matching files.' : 'No file changes.'}{!!files.length && <button type="button" onClick={clear}>Clear filters</button>}</div>}
            </main>
        </div>
    </div>;
}
