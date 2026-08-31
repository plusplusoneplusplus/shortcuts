/**
 * ScopeSlideSwitcher — single sliding segmented control owning scope identity in
 * the remote-first desktop header:
 * `[💼 My Work] [🏠 My Life] │ [pin] [pin] │ [● workspace ⧉N ▾]`.
 * An absolutely-positioned "thumb" slides under the active segment (measured via
 * refs + ResizeObserver; the pin set and the workspace chip are variable-width).
 * The workspace segment embeds `WorkspaceIdentityChip`, whose chevron/popover
 * still switches remote groups without leaving the workspace scope. Rendered by
 * `TopBar` behind `features.scopeSwitcher`; the scope-bound content clusters
 * (WI/PR tabs, clone tabs, virtual sub-tabs + actions) stay in their headers, to
 * the right.
 *
 * The pin segments between the virtual scopes and the chip are behind the
 * separate `features.pinnedScopes` flag; they are user-ordered, persisted
 * globally (`usePinnedScopes`), and toggled from the picker rows in
 * `WorkspaceIdentityChip`.
 */
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { ToastContext } from '../../contexts/ToastContext';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { openScopePopOut } from '../scope-window/scopeWindow';
import { useMyWorkEnabled } from '../../hooks/feature-flags/useMyWorkEnabled';
import { useMyLifeEnabled } from '../../hooks/feature-flags/useMyLifeEnabled';
import { usePinnedScopesEnabled } from '../../hooks/feature-flags/usePinnedScopesEnabled';
import { useScopeNavigation } from '../../hooks/useScopeNavigation';
import { MY_WORK_WORKSPACE_ID } from '../../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../../repos/MyLifeView';
import { isRepoGroupWorkspaceId } from '../../repos/virtualWorkspaceIds';
import { resolveRepoGroupName } from '../../repos/repoGroupName';
import { getRepoSelectionId, isRepoSelected } from '../../repos/cloneIdentity';
import { groupKey, groupReposByRemote, type RepoData } from '../../repos/repoGrouping';
import { computeCloneStatusMap } from './shellModel';
import { resolvePinnedScopes, type ResolvedPinnedScope } from './pinnedScopes';
import { usePinnedScopes } from './usePinnedScopes';
import { useShellNavigation } from './useShellNavigation';
import { WorkspaceIdentityChip } from './WorkspaceIdentityChip';

export interface ScopeSlideSwitcherProps {
    repo?: RepoData;
    repos: RepoData[];
}

/**
 * Segment identity for the ref map and the thumb.
 *
 * This started as the closed union `'work' | 'life' | 'workspace'`, which N
 * user-defined pins cannot fit: a pin's key is only known at runtime. It is now
 * an open string, with pins keyed by their serialized `PinnedScopeRef` (already
 * unique and stable across reorders), and the accent lookup split off into
 * `ScopeAccent` below so it stays a closed set.
 */
type ScopeKey = string;
type FixedScopeKey = 'work' | 'life' | 'workspace';

// `group` has no segment of its own unless it is pinned — otherwise it borrows
// the workspace segment, so it needs an accent distinct from work's blue and
// life's purple to stay readable as "a repo group, not the repo underneath".
type ScopeAccent = FixedScopeKey | 'group';
const SCOPE_ACCENTS: Record<ScopeAccent, string> = {
    work: '#0969da',
    life: '#8957e5',
    workspace: '#656d76',
    group: '#1a7f37',
};

/** Stacked-layers marker, matching every other repo-group surface. */
function PinGroupGlyph() {
    return (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l9 5-9 5-9-5 9-5z" />
            <path d="M3 13l9 5 9-5" />
        </svg>
    );
}

export function ScopeSlideSwitcher({ repo, repos }: ScopeSlideSwitcherProps) {
    const { state } = useApp();
    const { state: queueState } = useQueue();
    const { remoteGroupWorkspaces, unseenCounts } = useRepos();
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();
    const pinnedScopesEnabled = usePinnedScopesEnabled();
    const { goToMyWork, goToMyLife } = useScopeNavigation();
    const { selectClone } = useShellNavigation();
    const { pins, move: movePin, toggle: togglePin } = usePinnedScopes();
    const toast = useContext(ToastContext);

    // Pop-out a scope into its own locked full-app window (AC-01). Repos, pins and
    // the virtual scopes route through the identical path — no special-casing (AC-04).
    const popOut = useCallback((workspaceId: string) => {
        openScopePopOut({ workspaceId, addToast: toast?.addToast });
    }, [toast]);

    // Lightweight right-click menu (this switcher has none of its own yet).
    const [menu, setMenu] = useState<{ workspaceId: string; label: string; x: number; y: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!menu) return;
        const onDown = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const openScopeMenu = useCallback((e: { preventDefault: () => void; clientX: number; clientY: number }, workspaceId: string, label: string) => {
        e.preventDefault();
        setMenu({ workspaceId, label, x: e.clientX, y: e.clientY });
    }, []);

    const renderPopOutIcon = (workspaceId: string, label: string) => (
        <span
            role="button"
            tabIndex={0}
            data-testid="scope-segment-popout"
            data-workspace-id={workspaceId}
            aria-label={`Open ${label} in new window`}
            title="Open in new window"
            className="inline-flex items-center justify-center w-4 h-4 rounded text-current opacity-0 group-hover:opacity-70 group-focus-within:opacity-70 hover:!opacity-100 hover:bg-black/[0.08] dark:hover:bg-white/[0.12] transition-opacity"
            onClick={e => { e.stopPropagation(); e.preventDefault(); popOut(workspaceId); }}
            onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    popOut(workspaceId);
                }
            }}
        >
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <path d="M5 2H2.5v7.5H10V7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 2h3v3M10 2 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </span>
    );

    const isOnReposTab = state.activeTab === 'repos';

    // ── Pin resolution ───────────────────────────────────────────────────────
    // Both the git-remote clusters and the repo-group virtual workspaces have to
    // be rebuilt here rather than read off the chip: the chip owns them for its
    // popover, but a pin segment has to render (name, dot, badge) whether or not
    // the popover has ever been opened.
    const groups = useMemo(() => groupReposByRemote(repos, {}), [repos]);
    const cloneStatus = useMemo(
        () => computeCloneStatusMap(repos, queueState.repoQueueMap, isHiddenTask),
        [repos, queueState.repoQueueMap],
    );
    const groupWorkspaces = useMemo(() => {
        const local = ((state.workspaces ?? []) as { id?: unknown }[]).filter(ws => isRepoGroupWorkspaceId(String(ws?.id ?? '')));
        const remote = ((remoteGroupWorkspaces ?? []) as { id?: unknown }[]).filter(ws => isRepoGroupWorkspaceId(String(ws?.id ?? '')));
        return remote.length > 0 ? [...local, ...remote] : local;
    }, [state.workspaces, remoteGroupWorkspaces]);
    // Stale pins (repo removed, group deleted, server offline) drop out of the
    // rendered set only — the stored list is never rewritten, so they come back
    // when their target does.
    const pinSegments = useMemo(
        () => (pinnedScopesEnabled
            ? resolvePinnedScopes(pins, { groups, groupWorkspaces, cloneStatus, unseenCounts: unseenCounts ?? {} })
            : []),
        [pinnedScopesEnabled, pins, groups, groupWorkspaces, cloneStatus, unseenCounts],
    );

    // A repo group is a virtual scope without its own segment: unless pinned it
    // takes the workspace segment over, which shows the group's identity and
    // reads as selected.
    const groupScopeActive = isOnReposTab && isRepoGroupWorkspaceId(state.selectedRepoId);

    // The git-remote cluster the chip's repo belongs to — the key a `repo:` pin
    // is matched against to decide whether the pin, not the chip, is the active
    // segment.
    const chipGroupKey = useMemo(() => {
        if (!repo) return null;
        const cloneId = getRepoSelectionId(repo);
        const group = groups.find(g => g.repos.some(r => isRepoSelected(r, repos, cloneId)));
        return group ? groupKey(group) : null;
    }, [repo, repos, groups]);

    const virtualScopeActive =
        (myWorkEnabled && isOnReposTab && state.selectedRepoId === MY_WORK_WORKSPACE_ID)
        || (myLifeEnabled && isOnReposTab && state.selectedRepoId === MY_LIFE_WORKSPACE_ID);

    // Care-point: a pinned scope that is currently selected must own the thumb,
    // otherwise the workspace segment would light up for a scope it is not
    // showing. A `group:` pin matches the selected virtual workspace id; a
    // `repo:` pin matches the cluster the selected repo lives in.
    const activePin = useMemo<ResolvedPinnedScope | null>(() => {
        if (!isOnReposTab || virtualScopeActive) return null;
        for (const pin of pinSegments) {
            if (pin.ref.kind === 'group') {
                if (state.selectedRepoId === pin.ref.key) return pin;
            } else if (!groupScopeActive && chipGroupKey && chipGroupKey === pin.ref.key) {
                return pin;
            }
        }
        return null;
    }, [isOnReposTab, virtualScopeActive, pinSegments, state.selectedRepoId, groupScopeActive, chipGroupKey]);

    const fixedScope: FixedScopeKey =
        myWorkEnabled && isOnReposTab && state.selectedRepoId === MY_WORK_WORKSPACE_ID
            ? 'work'
            : myLifeEnabled && isOnReposTab && state.selectedRepoId === MY_LIFE_WORKSPACE_ID
                ? 'life'
                : 'workspace';
    const activeScope: ScopeKey = activePin ? activePin.id : fixedScope;
    const workspaceSegmentActive = fixedScope === 'workspace' && !activePin;
    const activeAccent: ScopeAccent = activePin
        ? (activePin.ref.kind === 'group' ? 'group' : 'workspace')
        : (groupScopeActive ? 'group' : fixedScope);

    // Care-point: once a repo group has its own pinned segment, the chip must
    // stop claiming that identity or the group name renders twice in one bar.
    // The pin wins (it is the segment the user asked for), and the chip falls
    // back to the remembered repo in the inactive/switch-back state it already
    // uses under My Work / My Life.
    const groupIdentity = useMemo(() => {
        if (!groupScopeActive || activePin) return undefined;
        const id = state.selectedRepoId!;
        return { id, name: resolveRepoGroupName(id, state.workspaces, remoteGroupWorkspaces) };
    }, [groupScopeActive, activePin, state.selectedRepoId, state.workspaces, remoteGroupWorkspaces]);

    // The same clash in its other form: an active `repo:` pin shows the very
    // cluster the chip would show, so the chip drops to a bare picker trigger
    // (chevron only) instead of echoing the pin's label a second time.
    const chipEchoesActivePin = !!activePin && activePin.ref.kind === 'repo';

    // When My Work / My Life / a pin is active, the workspace segment shows the
    // remembered workspace but is *inactive*.
    // Clicking its body switches back to that workspace, re-selecting it as the
    // active scope (restoring the last-viewed note path exactly like selecting a
    // workspace normally does via `selectClone`). The chevron keeps opening the
    // picker. (AC-02)
    const switchBackToWorkspace = useCallback(() => {
        if (repo) selectClone(getRepoSelectionId(repo));
    }, [repo, selectClone]);
    // Deliberately NOT offered while an *unpinned* group is active: the pill then
    // reads the group's name, so a body click silently navigating to the
    // remembered repo would contradict its own label. Group scope switches
    // through the chevron's picker instead. With the group pinned the pill is
    // back to the repo's own name, so switch-back is meaningful again.
    const onSwitchBack = !workspaceSegmentActive && !groupIdentity && !chipEchoesActivePin && repo
        ? switchBackToWorkspace
        : undefined;

    // Pop-out / right-click follow whatever identity the segment is showing, so a
    // group-labelled pill never opens a window on the repo remembered under it.
    const segmentTarget = groupIdentity
        ? { id: groupIdentity.id, label: groupIdentity.name }
        : (repo ? { id: getRepoSelectionId(repo), label: getRepoDisplayLabel(repo) } : null);

    const containerRef = useRef<HTMLDivElement>(null);
    const segmentRefs = useRef<Record<ScopeKey, HTMLElement | null>>({});
    const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

    const measure = useCallback(() => {
        const el = segmentRefs.current[activeScope];
        if (!el) {
            setThumb(null);
            return;
        }
        setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    }, [activeScope]);

    // Re-measure on scope change / segment set change, and on any size change of
    // the container or a segment (the workspace chip's width follows the remote
    // name and popover state). `pinSignature` is in the dependency list because
    // adding, removing OR reordering a pin shifts every segment to its right
    // without changing any segment's own size — a ResizeObserver alone would
    // never fire for a reorder. jsdom has neither ResizeObserver nor layout, so
    // tests assert data-scope/aria-selected instead of thumb pixels.
    const pinSignature = pinSegments.map(p => p.id).join('|');
    useLayoutEffect(() => {
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => measure());
        if (containerRef.current) ro.observe(containerRef.current);
        for (const el of Object.values(segmentRefs.current)) {
            if (el) ro.observe(el);
        }
        return () => ro.disconnect();
    }, [measure, myWorkEnabled, myLifeEnabled, repos, pinSignature]);

    const segmentClass = (active: boolean) =>
        'relative z-[1] inline-flex items-center gap-1 h-[26px] px-2 rounded-md text-[12.5px] whitespace-nowrap shrink-0 transition-colors ' +
        (active
            ? 'font-bold'
            : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]');

    const renderVirtualSegment = (
        key: FixedScopeKey,
        legacyId: string,
        icon: string,
        label: string,
        onClick: () => void,
        workspaceId: string,
    ) => {
        const active = activeScope === key;
        return (
            <button
                id={legacyId}
                ref={el => { segmentRefs.current[key] = el; }}
                role="tab"
                aria-selected={active}
                data-testid="scope-segment"
                data-scope={key}
                aria-label={label}
                title={label}
                onClick={onClick}
                onContextMenu={e => openScopeMenu(e, workspaceId, label)}
                className={segmentClass(active) + ' group'}
                style={active ? { color: SCOPE_ACCENTS[key] } : undefined}
            >
                <span aria-hidden>{icon}</span>
                <span className="hidden lg:inline">{label}</span>
                {renderPopOutIcon(workspaceId, label)}
            </button>
        );
    };

    /**
     * A hover-revealed control inside a pin segment. `span role="button"` rather
     * than a `<button>` because the segment itself is a button and buttons may
     * not nest — the same trick `renderPopOutIcon` already uses.
     */
    const pinControl = (
        testId: string,
        pin: ResolvedPinnedScope,
        label: string,
        glyph: string,
        onActivate: () => void,
        disabled = false,
    ) => (
        <span
            role="button"
            tabIndex={disabled ? -1 : 0}
            data-testid={testId}
            data-pin-id={pin.id}
            aria-label={`${label} ${pin.label}`}
            aria-disabled={disabled || undefined}
            title={label}
            className={
                'inline-flex items-center justify-center w-4 h-4 rounded text-current text-[11px] leading-none transition-opacity '
                + (disabled
                    ? 'opacity-0 pointer-events-none'
                    : 'opacity-0 group-hover:opacity-70 group-focus-within:opacity-70 hover:!opacity-100 hover:bg-black/[0.08] dark:hover:bg-white/[0.12]')
            }
            onClick={e => {
                if (disabled) return;
                e.stopPropagation();
                e.preventDefault();
                onActivate();
            }}
            onKeyDown={e => {
                if (disabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    e.preventDefault();
                    onActivate();
                }
            }}
        >
            <span aria-hidden>{glyph}</span>
        </span>
    );

    const renderPinSegment = (pin: ResolvedPinnedScope, index: number) => {
        const active = activeScope === pin.id;
        const accent = SCOPE_ACCENTS[pin.ref.kind === 'group' ? 'group' : 'workspace'];
        return (
            <button
                key={pin.id}
                ref={el => {
                    // Delete rather than null out: a stale key would keep the
                    // thumb measuring a segment that no longer exists.
                    if (el) segmentRefs.current[pin.id] = el;
                    else delete segmentRefs.current[pin.id];
                }}
                role="tab"
                aria-selected={active}
                data-testid="scope-segment"
                data-scope="pin"
                data-pin-id={pin.id}
                data-pin-kind={pin.ref.kind}
                aria-label={pin.label}
                title={pin.label}
                onClick={() => selectClone(pin.targetId)}
                onContextMenu={e => openScopeMenu(e, pin.workspaceId, pin.label)}
                className={segmentClass(active) + ' group max-w-[170px]'}
                style={active ? { color: accent } : undefined}
            >
                {pin.ref.kind === 'group' ? (
                    <PinGroupGlyph />
                ) : (
                    <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: pin.color }} aria-hidden />
                )}
                {/* Narrow windows drop the label to icon-only (below `xl`) before
                    the whole pin strip goes (below `lg`) — a pin without its name
                    is still a usable target, a missing pin is not. */}
                <span className="hidden xl:inline truncate">{pin.label}</span>
                {pin.unseen > 0 && (
                    <span
                        data-testid="scope-pin-unseen-badge"
                        data-pin-id={pin.id}
                        aria-label={`${pin.unseen} unread`}
                        className="min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none"
                    >
                        {pin.unseen > 99 ? '99+' : pin.unseen}
                    </span>
                )}
                {pinControl('scope-pin-move-left', pin, 'Move left', '‹', () => movePin(pin.ref, -1), index === 0)}
                {pinControl('scope-pin-move-right', pin, 'Move right', '›', () => movePin(pin.ref, 1), index === pinSegments.length - 1)}
                {renderPopOutIcon(pin.workspaceId, pin.label)}
                {pinControl('scope-pin-unpin', pin, 'Unpin', '✕', () => togglePin(pin.ref))}
            </button>
        );
    };

    const pinDivider = (side: 'left' | 'right') => (
        <span
            aria-hidden
            data-testid="scope-pin-divider"
            data-side={side}
            className="self-stretch my-[5px] mx-0.5 w-px bg-[#d0d7de] dark:bg-[#3c3c3c] shrink-0"
        />
    );

    return (
        <div
            ref={containerRef}
            data-testid="scope-switcher"
            data-active-scope={groupScopeActive ? 'group' : fixedScope}
            data-active-pin={activePin?.id}
            role="tablist"
            aria-label="Scope"
            className="relative hidden md:flex items-center gap-0.5 min-w-0 flex-shrink-0 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white/70 dark:bg-[#1e1e1e]/70 px-1"
        >
            {thumb && thumb.width > 0 && (
                <span
                    aria-hidden
                    data-testid="scope-switcher-thumb"
                    className="absolute top-[3px] bottom-[3px] rounded-md transition-[left,width] duration-300 ease-out pointer-events-none"
                    style={{ left: thumb.left, width: thumb.width, background: `${SCOPE_ACCENTS[activeAccent]}26` }}
                />
            )}
            {myWorkEnabled && renderVirtualSegment('work', 'my-work-toggle', '💼', 'My Work', goToMyWork, MY_WORK_WORKSPACE_ID)}
            {myLifeEnabled && renderVirtualSegment('life', 'my-life-toggle', '🏠', 'My Life', goToMyLife, MY_LIFE_WORKSPACE_ID)}
            {pinSegments.length > 0 && (
                // Below `lg` the pins are dropped entirely so identity + the
                // virtual scopes keep their room in a narrow header.
                <div data-testid="scope-pin-strip" className="hidden lg:flex items-center gap-0.5 min-w-0">
                    {pinDivider('left')}
                    {pinSegments.map(renderPinSegment)}
                    {pinDivider('right')}
                </div>
            )}
            {/* Keep this positioned without a z-index so the nested picker can
                escape the segment and layer above page-level sticky headers. */}
            <div
                ref={el => { segmentRefs.current.workspace = el; }}
                role="tab"
                aria-selected={workspaceSegmentActive}
                data-testid="scope-segment"
                data-scope="workspace"
                className="group relative flex items-center min-w-0"
                onContextMenu={segmentTarget ? e => openScopeMenu(e, segmentTarget.id, segmentTarget.label) : undefined}
            >
                <WorkspaceIdentityChip
                    repo={repo}
                    repos={repos}
                    onSwitchBack={onSwitchBack}
                    groupIdentity={groupIdentity}
                    identitySuppressed={chipEchoesActivePin}
                />
                {segmentTarget && !chipEchoesActivePin && renderPopOutIcon(segmentTarget.id, segmentTarget.label)}
            </div>
            {menu && (
                <div
                    ref={menuRef}
                    data-testid="scope-switcher-context-menu"
                    role="menu"
                    className="fixed z-[10001] min-w-[160px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                    style={{ left: menu.x, top: menu.y }}
                >
                    <button
                        data-testid="scope-switcher-context-open-window"
                        className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                        role="menuitem"
                        onClick={() => {
                            const id = menu.workspaceId;
                            setMenu(null);
                            popOut(id);
                        }}
                    >
                        🪟 Open in new window
                    </button>
                </div>
            )}
        </div>
    );
}

/** Human-readable scope label for the pop-out affordances / OS window title. */
function getRepoDisplayLabel(repo: RepoData): string {
    const ws = repo.workspace as { name?: string; id?: string };
    return ws.name || ws.id || 'workspace';
}
