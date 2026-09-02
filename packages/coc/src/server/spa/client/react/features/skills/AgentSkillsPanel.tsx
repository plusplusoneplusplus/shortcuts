import './agent-skills-redesign.css';

import { useEffect, useMemo, useState } from 'react';
import type { RepoData } from '../../repos/repoGrouping';
import { AgentSkillsIcons as I } from './agent-skills-icons';
import { InstallSkillsDialog } from './InstallSkillsDialog';
import { LinkSkillSourcePopover } from './LinkSkillSourcePopover';
import { SkillsResolutionOrder } from './SkillsResolutionOrder';
import { SkillsSourceRail } from './SkillsSourceRail';
import { WorkspaceSkillCard } from './WorkspaceSkillCard';
import {
    buildSkillsResolutionItems,
    buildSkillsSources,
    filterWorkspaceSkills,
    getSkillSourcePresentation,
    groupSkillsByFolder,
    type Skill,
    type SkillDetail,
    type SkillRepoSummary,
    type SkillStatusFilter,
    type SkillsSourceItem,
} from './skills-ui-model';
import type {
    WorkspaceSkillsClientResolver,
    WorkspaceSkillsController,
} from './useWorkspaceSkillsController';

export { groupSkillsByFolder } from './skills-ui-model';
export type { Skill, SkillDetail, SkillFolderGroup } from './skills-ui-model';

export interface AgentSkillsPanelProps {
    workspaceId: string;
    workspaceName?: string;
    controller: WorkspaceSkillsController;
    resolveClient: WorkspaceSkillsClientResolver;
    allRepos?: RepoData[];
}

export function AgentSkillsPanel({
    workspaceId,
    workspaceName,
    controller,
    resolveClient,
    allRepos = [],
}: AgentSkillsPanelProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<SkillStatusFilter>('all');
    const [activeSource, setActiveSource] = useState('all');
    const [showInstallDialog, setShowInstallDialog] = useState(false);
    const [showRepoPicker, setShowRepoPicker] = useState(false);

    const repoById = useMemo(() => new Map<string, SkillRepoSummary>(
        allRepos.map(repo => [repo.workspace.id, repo.workspace as SkillRepoSummary]),
    ), [allRepos]);
    const skillGroups = useMemo(
        () => groupSkillsByFolder(controller.skills, repoById),
        [controller.skills, repoById],
    );
    const sources = useMemo(
        () => buildSkillsSources(controller.skills, skillGroups, repoById),
        [controller.skills, repoById, skillGroups],
    );
    const filteredSkills = useMemo(() => filterWorkspaceSkills({
        skills: controller.skills,
        sources,
        activeSource,
        status: filterStatus,
        searchQuery,
        disabledSkills: controller.disabledSkills,
    }), [activeSource, controller.disabledSkills, controller.skills, filterStatus, searchQuery, sources]);
    const resolutionItems = useMemo(() => buildSkillsResolutionItems(
        skillGroups,
        controller.extraSkillFolders,
        controller.linkedRepoIds,
        repoById,
    ), [controller.extraSkillFolders, controller.linkedRepoIds, repoById, skillGroups]);
    const enabledCount = useMemo(() => {
        const disabled = new Set(controller.disabledSkills);
        return controller.skills.filter(skill => !disabled.has(skill.name)).length;
    }, [controller.disabledSkills, controller.skills]);
    const otherRepos = useMemo(
        () => allRepos.filter(repo => repo.workspace.id !== workspaceId),
        [allRepos, workspaceId],
    );

    useEffect(() => {
        setSearchQuery('');
        setFilterStatus('all');
        setActiveSource('all');
        setShowInstallDialog(false);
        setShowRepoPicker(false);
    }, [workspaceId]);

    useEffect(() => {
        if (!sources.some(source => source.id === activeSource)) {setActiveSource('all');}
    }, [activeSource, sources]);

    const clearFilters = () => {
        setSearchQuery('');
        setActiveSource('all');
        setFilterStatus('all');
    };

    const removeSource = (source: SkillsSourceItem) => {
        if (source.repoId) {
            void controller.unlinkRepo(source.repoId);
        } else if (source.folderPath) {
            void controller.removeExtraSkillFolder(source.folderPath);
        }
    };

    return (
        <div className="agent-skills-redesign" data-testid="agent-skills-panel">
            <header className="ask-page-header">
                <div className="ask-crumbs">
                    <span>{workspaceName ?? 'workspace'}</span>
                    <span className="ask-sep">/</span>
                    <span>Settings</span>
                    <span className="ask-sep">/</span>
                    <span className="ask-current">Agent Skills</span>
                </div>
                <div className="ask-h1-row">
                    <div><h1 className="ask-h1">Agent Skills</h1></div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button type="button" className="ask-btn" onClick={() => void controller.refresh()} title="Refresh skills" data-testid="skills-refresh-btn">
                            <I.refresh className="ask-icon" /> Refresh
                        </button>
                        <button type="button" className="ask-btn ask-primary" onClick={() => setShowInstallDialog(true)} data-testid="skills-install-btn">
                            <I.plus className="ask-icon" /> Install skills
                        </button>
                    </div>
                </div>
            </header>

            <div className="ask-toolbar">
                <label className="ask-search">
                    <I.search className="ask-icon" />
                    <input
                        type="search"
                        placeholder="Search skills, descriptions, triggers…"
                        value={searchQuery}
                        onChange={event => setSearchQuery(event.target.value)}
                        data-testid="skills-search-input"
                    />
                    <span className="ask-kbd">⌘K</span>
                </label>
                <div className="ask-chips" role="tablist">
                    {([
                        { id: 'all' as const, label: 'All', count: controller.skills.length },
                        { id: 'on' as const, label: 'Enabled', count: enabledCount },
                        { id: 'off' as const, label: 'Disabled', count: controller.skills.length - enabledCount },
                    ]).map(filter => (
                        <button
                            key={filter.id}
                            type="button"
                            role="tab"
                            aria-selected={filterStatus === filter.id}
                            className={`ask-chip ${filterStatus === filter.id ? 'active' : ''}`}
                            onClick={() => setFilterStatus(filter.id)}
                            data-testid={`skills-filter-${filter.id}`}
                        >
                            {filter.label} <span className="ask-ct">{filter.count}</span>
                        </button>
                    ))}
                </div>
                <div className="ask-spacer" />
                {otherRepos.length > 0 && (
                    <div className="ask-popover-anchor">
                        <button type="button" className="ask-btn ask-sm ask-ghost" onClick={() => setShowRepoPicker(open => !open)} data-testid="link-from-repo-btn">
                            <I.link className="ask-icon" /> Link a repo
                        </button>
                        {showRepoPicker && (
                            <LinkSkillSourcePopover
                                repos={otherRepos}
                                linkedRepoIds={controller.linkedRepoIds}
                                loadRepoSkills={controller.probeRepoSkills}
                                onLink={controller.linkRepo}
                                onUnlink={controller.unlinkRepo}
                                onClose={() => setShowRepoPicker(false)}
                            />
                        )}
                    </div>
                )}
            </div>

            <div className="ask-body">
                <SkillsSourceRail
                    scopeKey={workspaceId}
                    sources={sources}
                    activeSource={activeSource}
                    onSelect={source => setActiveSource(current => current === source.id ? 'all' : source.id)}
                    onRemove={removeSource}
                    onAddFolder={folderPath => void controller.addExtraSkillFolder(folderPath)}
                />

                <section className="ask-list">
                    {controller.skillsError && (
                        <div className="ask-empty-source" role="alert" data-testid="skills-load-error">
                            <div style={{ color: 'var(--ask-danger)', marginBottom: 8 }}>{controller.skillsError}</div>
                            <button type="button" className="ask-btn ask-sm" onClick={() => void controller.refresh()}>Retry</button>
                        </div>
                    )}
                    {controller.skillsLoading ? (
                        <div className="ask-loading">Loading skills…</div>
                    ) : controller.skills.length === 0 && !controller.skillsError ? (
                        <div className="ask-empty-source" data-testid="skills-empty-state">
                            <div style={{ fontSize: 14, color: 'var(--ask-text-2)', marginBottom: 4 }}>No skills installed</div>
                            <div style={{ fontSize: 12.5 }}>
                                Skills are AI prompt modules stored in <code>.github/skills/</code>. They extend the agent&apos;s capabilities for specific tasks.
                            </div>
                            <div style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <button type="button" className="ask-btn ask-sm" onClick={() => setShowInstallDialog(true)}>
                                    <I.plus className="ask-icon" /> Install skills
                                </button>
                                {otherRepos.length > 0 && (
                                    <button type="button" className="ask-btn ask-sm ask-ghost" onClick={() => setShowRepoPicker(true)} data-testid="empty-state-link-repo-btn">
                                        <I.link className="ask-icon" /> Link a repo
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : controller.skills.length > 0 ? (
                        <>
                            <div className="ask-list-meta">
                                <span>{filteredSkills.length} skill{filteredSkills.length === 1 ? '' : 's'} shown</span>
                                {(searchQuery || activeSource !== 'all' || filterStatus !== 'all') && (
                                    <button type="button" className="ask-btn ask-sm ask-ghost" onClick={clearFilters} data-testid="skills-clear-filters">Clear filters</button>
                                )}
                                <span className="ask-order">Sort: A→Z</span>
                            </div>

                            {filteredSkills.length === 0 ? (
                                <div className="ask-empty-source">
                                    <div style={{ fontSize: 14, color: 'var(--ask-text-2)', marginBottom: 4 }}>No skills match these filters</div>
                                    <div style={{ fontSize: 12.5 }}>Try clearing the search or filters.</div>
                                </div>
                            ) : (
                                <div className="ask-skill-cards" data-testid="skills-list">
                                    {[...filteredSkills].sort((a, b) => a.name.localeCompare(b.name)).map(skill => {
                                        const source = getSkillSourcePresentation(skill, repoById);
                                        const isOpen = controller.expandedSkill === skill.name;
                                        return (
                                            <WorkspaceSkillCard
                                                key={skill.name}
                                                workspaceId={workspaceId}
                                                skill={skill}
                                                detail={isOpen ? controller.skillDetail : null}
                                                detailLoading={isOpen ? controller.detailLoading : false}
                                                detailError={isOpen ? controller.detailError : null}
                                                isOpen={isOpen}
                                                isEnabled={!controller.disabledSkills.includes(skill.name)}
                                                deleteConfirming={controller.deleteConfirm === skill.name}
                                                sourceLabel={source.sourceLabel}
                                                sourceKind={source.kind}
                                                sourcePillLabel={source.sourcePillLabel}
                                                hideDelete={source.hideDelete}
                                                toggleDisabled={controller.skillToggleSaving || controller.skillsLoading}
                                                onToggleOpen={() => void controller.expandSkill(skill.name)}
                                                onToggleEnabled={enabled => void controller.toggleSkill(skill.name, enabled)}
                                                onSetDeleteConfirm={confirming => controller.setDeleteConfirm(confirming ? skill.name : null)}
                                                onDelete={() => void controller.deleteSkill(skill.name)}
                                                loadFile={controller.readSkillFile}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            <SkillsResolutionOrder items={resolutionItems} onMove={(folder, delta) => void controller.moveExtraSkillFolder(folder, delta)} />
                            <div className="ask-footer-note">Changes are saved automatically · PATCH /api/workspaces/{workspaceId}/skills-config</div>
                        </>
                    ) : null}
                </section>
            </div>

            {showInstallDialog && (
                <InstallSkillsDialog
                    workspaceId={workspaceId}
                    resolveClient={resolveClient}
                    onClose={() => setShowInstallDialog(false)}
                    onInstalled={() => {
                        setShowInstallDialog(false);
                        void controller.refresh();
                    }}
                />
            )}
        </div>
    );
}
