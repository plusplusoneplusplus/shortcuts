import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceSkillsPathResponse } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import type { RepoData } from '../../repos/repoGrouping';
import type { SkillRepoSummary } from './skills-ui-model';

interface RepoSkillsInfo extends WorkspaceSkillsPathResponse {
    loading: boolean;
    error?: string;
}

export interface LinkSkillSourcePopoverProps {
    repos: RepoData[];
    linkedRepoIds: string[];
    loadRepoSkills: (repoId: string) => Promise<WorkspaceSkillsPathResponse>;
    onLink: (repo: SkillRepoSummary) => Promise<boolean>;
    onUnlink: (repoId: string) => Promise<void>;
    onClose: () => void;
}

export function LinkSkillSourcePopover({
    repos,
    linkedRepoIds,
    loadRepoSkills,
    onLink,
    onUnlink,
    onClose,
}: LinkSkillSourcePopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const requestGeneration = useRef(0);
    const [skillsInfo, setSkillsInfo] = useState<Record<string, RepoSkillsInfo>>({});
    const [filterText, setFilterText] = useState('');

    useEffect(() => {
        function handleClick(event: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {onClose();}
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    useEffect(() => {
        const generation = ++requestGeneration.current;
        setSkillsInfo(Object.fromEntries(repos.map(repo => [repo.workspace.id, {
            path: '',
            skillCount: 0,
            accessible: false,
            loading: true,
        }])));

        void Promise.all(repos.map(async repo => {
            const id = repo.workspace.id as string;
            try {
                const info = await loadRepoSkills(id);
                return [id, { ...info, loading: false }] as const;
            } catch (error) {
                return [id, {
                    path: '',
                    skillCount: 0,
                    accessible: false,
                    loading: false,
                    error: getSpaCocClientErrorMessage(error, 'Failed to inspect skills'),
                }] as const;
            }
        })).then(entries => {
            if (generation === requestGeneration.current) {setSkillsInfo(Object.fromEntries(entries));}
        });

        return () => {
            requestGeneration.current += 1;
        };
    }, [loadRepoSkills, repos]);

    const filteredRepos = useMemo(() => {
        if (!filterText) {return repos;}
        const query = filterText.toLowerCase();
        return repos.filter(repo =>
            repo.workspace.name.toLowerCase().includes(query)
            || (repo.workspace.remoteUrl || '').toLowerCase().includes(query),
        );
    }, [filterText, repos]);

    return (
        <div ref={popoverRef} className="ask-popover" data-testid="link-from-repo-popover">
            <div className="ask-popover-header">Link skills from another repo</div>
            {repos.length > 8 && (
                <div className="ask-popover-filter">
                    <input
                        autoFocus
                        type="text"
                        placeholder="Filter repos…"
                        value={filterText}
                        onChange={event => setFilterText(event.target.value)}
                        data-testid="repo-picker-filter"
                    />
                </div>
            )}
            <div className="ask-popover-list">
                {filteredRepos.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: 'var(--ask-text-3)', textAlign: 'center' }}>No repos found</div>
                ) : filteredRepos.map(repo => {
                    const workspace = repo.workspace as SkillRepoSummary & { remoteUrl?: string };
                    const isLinked = linkedRepoIds.includes(workspace.id);
                    const info = skillsInfo[workspace.id];
                    const remoteDisplay = workspace.remoteUrl || workspace.rootPath || '';
                    const truncatedRemote = remoteDisplay.length > 45 ? `…${remoteDisplay.slice(-42)}` : remoteDisplay;
                    const unavailable = !isLinked && !!info && !info.loading && !info.accessible;
                    return (
                        <button
                            key={workspace.id}
                            type="button"
                            className="ask-popover-item"
                            style={isLinked ? { opacity: 0.75 } : undefined}
                            onClick={() => {
                                if (isLinked) {void onUnlink(workspace.id);}
                                else {void onLink(workspace).then(linked => { if (linked) {onClose();} });}
                            }}
                            disabled={unavailable}
                            title={info?.error}
                            data-testid={`repo-picker-item-${workspace.id}`}
                        >
                            <span
                                className="ask-repo-dot"
                                style={{ background: isLinked ? 'var(--ask-accent)' : (workspace.color || 'var(--ask-text-3)') }}
                            />
                            <div className="ask-repo-meta">
                                <span className="ask-repo-name">
                                    {workspace.name}
                                    {isLinked && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ask-text-3)' }}>(linked)</span>}
                                </span>
                                {truncatedRemote && <span className="ask-repo-url">{truncatedRemote}</span>}
                            </div>
                            <span className="ask-repo-count" data-testid={`repo-picker-count-${workspace.id}`}>
                                {!info || info.loading ? '…' : info.error || !info.accessible ? 'Unavailable' : `${info.skillCount} skills`}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
