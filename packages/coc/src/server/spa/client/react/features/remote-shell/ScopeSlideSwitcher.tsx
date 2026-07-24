/**
 * ScopeSlideSwitcher — single sliding segmented control owning scope identity in
 * the remote-first desktop header: [💼 My Work] [🏠 My Life] [● workspace ⧉N ▾].
 * An absolutely-positioned "thumb" slides under the active segment (measured via
 * refs + ResizeObserver; segment 3 is variable-width). The workspace segment
 * embeds `WorkspaceIdentityChip`, whose chevron/popover still switches remote
 * groups without leaving the workspace scope. Rendered by `TopBar` behind
 * `features.scopeSwitcher`; the scope-bound content clusters (WI/PR tabs, clone
 * tabs, virtual sub-tabs + actions) stay in their headers, to the right.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useMyWorkEnabled } from '../../hooks/feature-flags/useMyWorkEnabled';
import { useMyLifeEnabled } from '../../hooks/feature-flags/useMyLifeEnabled';
import { useScopeNavigation } from '../../hooks/useScopeNavigation';
import { MY_WORK_WORKSPACE_ID } from '../../repos/MyWorkView';
import { MY_LIFE_WORKSPACE_ID } from '../../repos/MyLifeView';
import { getRepoSelectionId } from '../../repos/cloneIdentity';
import type { RepoData } from '../../repos/repoGrouping';
import { useShellNavigation } from './useShellNavigation';
import { WorkspaceIdentityChip } from './WorkspaceIdentityChip';

export interface ScopeSlideSwitcherProps {
    repo?: RepoData;
    repos: RepoData[];
}

type ScopeKey = 'work' | 'life' | 'workspace';

const SCOPE_ACCENTS: Record<ScopeKey, string> = {
    work: '#0969da',
    life: '#8957e5',
    workspace: '#656d76',
};

export function ScopeSlideSwitcher({ repo, repos }: ScopeSlideSwitcherProps) {
    const { state } = useApp();
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();
    const { goToMyWork, goToMyLife } = useScopeNavigation();
    const { selectClone } = useShellNavigation();

    const isOnReposTab = state.activeTab === 'repos';
    const activeScope: ScopeKey =
        myWorkEnabled && isOnReposTab && state.selectedRepoId === MY_WORK_WORKSPACE_ID
            ? 'work'
            : myLifeEnabled && isOnReposTab && state.selectedRepoId === MY_LIFE_WORKSPACE_ID
                ? 'life'
                : 'workspace';

    // When a virtual scope (My Work / My Life) is active, the workspace segment
    // shows the remembered workspace but is *inactive*. Clicking its body switches
    // back to that workspace, re-selecting it as the active scope (restoring the
    // last-viewed note path exactly like selecting a workspace normally does via
    // `selectClone`). The chevron keeps opening the picker. (AC-02)
    const switchBackToWorkspace = useCallback(() => {
        if (repo) selectClone(getRepoSelectionId(repo));
    }, [repo, selectClone]);
    const onSwitchBack = activeScope !== 'workspace' && repo ? switchBackToWorkspace : undefined;

    const containerRef = useRef<HTMLDivElement>(null);
    const segmentRefs = useRef<Partial<Record<ScopeKey, HTMLElement | null>>>({});
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
    // name and popover state). jsdom has neither ResizeObserver nor layout, so
    // tests assert data-scope/aria-selected instead of thumb pixels.
    useLayoutEffect(() => {
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => measure());
        if (containerRef.current) ro.observe(containerRef.current);
        for (const el of Object.values(segmentRefs.current)) {
            if (el) ro.observe(el);
        }
        return () => ro.disconnect();
    }, [measure, myWorkEnabled, myLifeEnabled, repos]);

    const segmentClass = (active: boolean) =>
        'relative z-[1] inline-flex items-center gap-1 h-[26px] px-2 rounded-md text-[12.5px] whitespace-nowrap shrink-0 transition-colors ' +
        (active
            ? 'font-bold'
            : 'font-semibold text-[#656d76] dark:text-[#999] hover:text-[#1f2328] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]');

    const renderVirtualSegment = (
        key: ScopeKey,
        legacyId: string,
        icon: string,
        label: string,
        onClick: () => void,
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
                className={segmentClass(active)}
                style={active ? { color: SCOPE_ACCENTS[key] } : undefined}
            >
                <span aria-hidden>{icon}</span>
                <span className="hidden lg:inline">{label}</span>
            </button>
        );
    };

    return (
        <div
            ref={containerRef}
            data-testid="scope-switcher"
            data-active-scope={activeScope}
            role="tablist"
            aria-label="Scope"
            className="relative hidden md:flex items-center gap-0.5 min-w-0 flex-shrink-0 rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-white/70 dark:bg-[#1e1e1e]/70 px-1"
        >
            {thumb && thumb.width > 0 && (
                <span
                    aria-hidden
                    data-testid="scope-switcher-thumb"
                    className="absolute top-[3px] bottom-[3px] rounded-md transition-[left,width] duration-300 ease-out pointer-events-none"
                    style={{ left: thumb.left, width: thumb.width, background: `${SCOPE_ACCENTS[activeScope]}26` }}
                />
            )}
            {myWorkEnabled && renderVirtualSegment('work', 'my-work-toggle', '💼', 'My Work', goToMyWork)}
            {myLifeEnabled && renderVirtualSegment('life', 'my-life-toggle', '🏠', 'My Life', goToMyLife)}
            <div
                ref={el => { segmentRefs.current.workspace = el; }}
                role="tab"
                aria-selected={activeScope === 'workspace'}
                data-testid="scope-segment"
                data-scope="workspace"
                className="relative z-[1] flex items-center min-w-0"
            >
                <WorkspaceIdentityChip repo={repo} repos={repos} onSwitchBack={onSwitchBack} />
            </div>
        </div>
    );
}
