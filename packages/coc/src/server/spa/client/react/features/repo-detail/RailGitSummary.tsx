/**
 * RailGitSummary — Git tiles on the collapsed workspace rail: working changes,
 * upstream sync and a vertical branch spine, sharing `RailHoverPreview`'s
 * hover/focus preview. A repo group shows member counts and lists each member's
 * own branch; it never presents a group branch.
 */
import { useCallback, useContext, useRef, type ReactNode } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { cn } from '../../ui';
import { useApp } from '../../contexts/AppContext';
import { formatRelativeTime } from '../../utils/format';
import type { RepoGroupMember } from '../../repos/repoGroupService';
import { BRANCH_RANGE_DEEP_LINK } from '../git/repoGitTab/useRepoGitSelection';
import { RailControlsContext, RailHoverPreview, type RailControls, type RailPreviewControl } from './RailHoverPreview';
import {
    describeGroupMember,
    groupBranchTile,
    groupChangesTile,
    groupSyncTile,
    repoBranchTile,
    repoChangesTile,
    repoSyncTile,
    syncState,
    type GroupRailGitInput,
    type RailGitTile,
    type RailGitTone,
    type RepoRailGitInput,
} from './railGitModel';
import { useGroupRailGit, useRepoRailGit } from './useRailGitSummary';

const TONE_CLASS: Record<RailGitTone, string> = {
    clean: 'text-[#16825d] dark:text-[#3fb950]',
    changed: 'text-[#b45309] dark:text-[#e2c08d]',
    conflict: 'text-[#b42318] dark:text-[#f48771]',
    muted: 'text-[#656d76] dark:text-[#aaa]',
};
const TILE_CLASS = 'border-[#e5e5e5] bg-transparent hover:bg-[#e8e8e8] dark:border-[#3c3c3c] dark:hover:bg-[#2d2d2d]';
const ACTION_CLASS = 'mt-1.5 mr-1 rounded border border-[#d0d7de] px-1.5 py-0.5 text-[10px] text-[#1878c8] hover:bg-[#eaf4ff] focus-visible:outline focus-visible:outline-[#007acc] dark:border-[#3c3c3c] dark:text-[#3794ff] dark:hover:bg-[#19384f]';
const ROW_CLASS = 'border-b border-[#e5e5e5] px-3 py-2 text-[11px] last:border-0 dark:border-[#3c3c3c]';
const META_CLASS = 'text-[10px] text-[#656d76] dark:text-[#aaa]';
/** Re-read on preview at most this often; hover alone can retrigger it. */
const PREVIEW_REFRESH_MS = 5000;

interface Tiles {
    changes: RailGitTile;
    sync: RailGitTile;
    branch: RailGitTile;
    stale: boolean;
}

interface Actions {
    openChanges: () => void;
    openSync: () => void;
}

function useRail(refresh: () => void): RailControls | null {
    const rail = useContext(RailControlsContext);
    const last = useRef(0);
    const onPreview = rail?.onPreview;
    const preview = useCallback(() => {
        onPreview?.();
        if (Date.now() - last.current < PREVIEW_REFRESH_MS) return;
        last.current = Date.now();
        refresh();
    }, [onPreview, refresh]);
    return rail && { ...rail, onPreview: preview };
}

function StaleMark({ stale }: { stale: boolean }) {
    return stale ? <span aria-hidden="true" className="absolute -right-1 -top-1 text-[8px] leading-none text-[#848484]">◷</span> : null;
}

function buildControls(tiles: Tiles, group: boolean, actions: Actions, body: (dismiss: () => void) => ReactNode): RailPreviewControl[] {
    const base = {
        count: 1,
        headingCount: false,
        closeLabel: 'Close Git preview',
        description: 'Focus to preview; click opens Git.',
        badgeClassName: '',
        icon: null,
        renderRows: body,
    };
    const tile = (key: string, value: RailGitTile, heading: string, onClick: () => void, text: ReactNode): RailPreviewControl => ({
        ...base,
        key,
        label: value.label,
        heading,
        onClick,
        className: cn(TILE_CLASS, TONE_CLASS[value.tone]),
        content: <>{text}<StaleMark stale={tiles.stale} /></>,
    });
    const syncText = tiles.sync.text;
    return [
        tile('git-changes', tiles.changes, group ? 'Repository changes' : 'Working changes', actions.openChanges,
            <span className="font-mono text-[10px] font-semibold leading-none" aria-hidden="true">{tiles.changes.text}</span>),
        tile('git-sync', tiles.sync, group ? 'Repository sync' : 'Sync status', actions.openSync,
            <span className={cn('font-mono leading-none tracking-tighter', syncText.length > 4 ? 'text-[7px]' : 'text-[9px]')} aria-hidden="true">{syncText}</span>),
        {
            ...tile('git-branch', tiles.branch, group ? 'Member repositories' : 'Branch', actions.openSync,
                <span className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] leading-none" style={{ writingMode: 'vertical-rl' }} aria-hidden="true">{tiles.branch.text}</span>),
            sizeClassName: 'w-7 min-h-12 max-h-40 flex-shrink overflow-hidden py-1.5',
            className: cn(TILE_CLASS, TONE_CLASS.muted),
        },
    ];
}

function Freshness({ readAt, failed, onRetry }: { readAt?: number; failed: boolean; onRetry: () => void }) {
    return (
        <li className={ROW_CLASS}>
            <div className={META_CLASS}>
                {readAt ? `Read ${formatRelativeTime(new Date(readAt).toISOString())}.` : 'Not read yet.'}
                {failed && (readAt ? ' Latest read failed; showing last known status.' : ' Git status could not be read.')}
            </div>
            {failed && <button type="button" className={ACTION_CLASS} onClick={onRetry}>Retry read</button>}
        </li>
    );
}

interface RepoProps {
    workspaceId: string;
    routingRef: string;
    client: CocClient;
    scopeLabel: string;
}

/** Rail Git tiles for one repository on its owning server. */
export function RepoRailGit({ workspaceId, routingRef, client, scopeLabel }: RepoProps) {
    const { input, refresh } = useRepoRailGit({ client, routingRef, workspaceId, enabled: true });
    const rail = useRail(refresh);
    const { dispatch } = useApp();
    if (!rail) return null;
    const tiles: Tiles = {
        changes: repoChangesTile(input),
        sync: repoSyncTile(input),
        branch: repoBranchTile(input),
        stale: (input.info.failed && !!input.info.data) || (input.tree.failed && !!input.tree.data),
    };
    const actions: Actions = {
        openChanges: () => rail.onOpenGit?.('changes'),
        openSync: () => {
            rail.onOpenGit?.('branch');
            dispatch({ type: 'SET_GIT_ROUTE', routeWorkspaceId: workspaceId, workspaceId, commitHash: BRANCH_RANGE_DEEP_LINK, filePath: null });
        },
    };
    const body = (dismiss: () => void) => <RepoPreviewBody input={input} tiles={tiles} actions={actions} dismiss={dismiss} onRetry={refresh} />;
    return <RailHoverPreview controls={buildControls(tiles, false, actions, body)} scopeLabel={scopeLabel} {...rail} />;
}

function RepoPreviewBody({ input, tiles, actions, dismiss, onRetry }: { input: RepoRailGitInput; tiles: Tiles; actions: Actions; dismiss: () => void; onRetry: () => void }) {
    const tree = input.tree.data;
    const sync = syncState(input.info.data);
    const go = (action: () => void) => () => { dismiss(); action(); };
    return <>
        <li className={ROW_CLASS}>
            <div className="break-all font-mono text-xs font-medium" data-testid="rail-git-branch">{tiles.branch.text}</div>
        </li>
        <li className={ROW_CLASS} data-testid="rail-git-changes-detail">
            <div className={cn('font-medium', TONE_CLASS[tiles.changes.tone])}>{tiles.changes.label.replace(/^Working changes: /, '')}</div>
            {tree && tree.paths > 0 && (
                <div className={cn(META_CLASS, 'mt-0.5 font-mono')}>
                    {[tree.staged && `+${tree.staged} staged`, tree.modified && `~${tree.modified} modified`, tree.untracked && `?${tree.untracked} untracked`].filter(Boolean).join(' · ')}
                </div>
            )}
            {tree && tree.conflicts.length > 0 && (
                <ul className="mt-0.5 font-mono text-[10px]">
                    {tree.conflicts.slice(0, 5).map(file => <li key={file} className="truncate" title={file}>{file}</li>)}
                    {tree.conflicts.length > 5 && <li className={META_CLASS}>+{tree.conflicts.length - 5} more</li>}
                </ul>
            )}
            <button type="button" className={ACTION_CLASS} onClick={go(actions.openChanges)}>{tree?.conflicts.length ? 'Open conflicts' : 'Open working tree'}</button>
        </li>
        <li className={ROW_CLASS} data-testid="rail-git-sync-detail">
            <div className="font-medium">{tiles.sync.label.replace(/^Sync status: /, '')}</div>
            <div className={cn(META_CLASS, 'mt-0.5')}>
                {sync.kind === 'compared'
                    ? `Compared with upstream ${sync.upstream}, as of its last fetch.`
                    : 'Ahead/behind needs an upstream comparison; none is shown.'}
            </div>
            <button type="button" className={ACTION_CLASS} onClick={go(actions.openSync)}>Open branch overview</button>
        </li>
        <Freshness readAt={input.tree.readAt ?? input.info.readAt} failed={input.info.failed || input.tree.failed} onRetry={onRetry} />
    </>;
}

interface GroupProps {
    /** Group selection id; the Git route page owner `RepoGroupGitTab` matches. */
    selectionId: string;
    routingRef: string;
    client: CocClient;
    members: readonly RepoGroupMember[] | undefined;
    scopeLabel: string;
}

/** Rail Git tiles for a repo group: member counts plus a per-member preview. */
export function GroupRailGit({ selectionId, routingRef, client, members, scopeLabel }: GroupProps) {
    const { input, refresh } = useGroupRailGit({ client, routingRef, members, enabled: true });
    const rail = useRail(refresh);
    const { dispatch } = useApp();
    if (!rail) return null;
    const tiles: Tiles = {
        changes: groupChangesTile(input),
        sync: groupSyncTile(input),
        branch: groupBranchTile(input),
        stale: input.read.failed && !!input.read.data,
    };
    const openGit = () => rail.onOpenGit?.('changes');
    const actions: Actions = { openChanges: openGit, openSync: openGit };
    const openMember = (memberId: string) => {
        rail.onOpenGit?.('branch');
        dispatch({ type: 'SET_GIT_ROUTE', routeWorkspaceId: selectionId, workspaceId: memberId, commitHash: null, filePath: null });
    };
    const body = (dismiss: () => void) => <GroupPreviewBody input={input} tiles={tiles} dismiss={dismiss} onOpenMember={openMember} onRetry={refresh} />;
    return <RailHoverPreview controls={buildControls(tiles, true, actions, body)} scopeLabel={scopeLabel} {...rail} />;
}

function GroupPreviewBody({ input, tiles, dismiss, onOpenMember, onRetry }: { input: GroupRailGitInput; tiles: Tiles; dismiss: () => void; onOpenMember: (id: string) => void; onRetry: () => void }) {
    return <>
        <li className={ROW_CLASS}>
            <div>{tiles.changes.label.replace(/^Repository changes: /, '')}</div>
            <div>{tiles.sync.label.replace(/^Repository sync: /, '')}</div>
            <div className={cn(META_CLASS, 'mt-0.5')}>Counts are repositories; each member keeps its own branch.</div>
        </li>
        {(input.members ?? []).map(member => {
            const line = describeGroupMember(member);
            return (
                <li key={member.id} className={ROW_CLASS} data-testid="rail-git-member" data-member={member.id}>
                    <div className="font-medium">{member.name}</div>
                    <div className="break-all font-mono text-[10px]">{line.branch}</div>
                    <div className={META_CLASS}>{[line.changes, line.sync].filter(Boolean).join(' · ')}</div>
                    {!member.stale && member.info?.isGitRepo && (
                        <button type="button" className={ACTION_CLASS} aria-label={`Open ${member.name} Git`} onClick={() => { dismiss(); onOpenMember(member.id); }}>Open repository Git</button>
                    )}
                </li>
            );
        })}
        <Freshness readAt={input.read.readAt} failed={input.read.failed} onRetry={onRetry} />
    </>;
}
