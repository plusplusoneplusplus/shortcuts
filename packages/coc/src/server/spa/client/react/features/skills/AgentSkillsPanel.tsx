/**
 * AgentSkillsPanel — Agent Skills section extracted from RepoCopilotTab.
 * Includes SkillDetailPanel and InstallSkillsDialog sub-components.
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '../../ui';
import { SkillListItem } from '../../shared';
import type { SkillInfo } from '../../shared';
import { useGlobalToast } from '../../contexts/ToastContext';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import type { RepoData } from '../../repos/repoGrouping';

export type Skill = SkillInfo;

export type SkillDetail = Skill;

export interface BundledSkill {
    name: string;
    description?: string;
    path: string;
    alreadyExists?: boolean;
}

export type InstallSource = 'bundled' | 'github';

interface AgentSkillsPanelProps {
    workspaceId: string;
    skills: Skill[];
    skillsLoading: boolean;
    disabledSkills: string[];
    skillToggleSaving: boolean;
    expandedSkill: string | null;
    skillDetail: SkillDetail | null;
    detailLoading: boolean;
    deleteConfirm: string | null;
    onExpandSkill: (name: string) => void;
    onDeleteSkill: (name: string) => void;
    onSkillToggle: (name: string, enabled: boolean) => void;
    onSetDeleteConfirm: (name: string | null) => void;
    onInstalled: () => void;
    extraSkillFolders?: string[];
    onExtraSkillFoldersChange?: (folders: string[]) => void;
    /** IDs of repos whose skill folders are currently linked. */
    linkedRepoIds?: string[];
    /** Called when the linked repo list changes (updates preferences). */
    onLinkedRepoIdsChange?: (ids: string[]) => void;
    /** All registered repos (from ReposContext) for the picker popover. */
    allRepos?: RepoData[];
}

// ============================================================================
// Folder Grouping
// ============================================================================

export interface SkillFolderGroup {
    key: string;
    label: string;
    folderPath: string;
    source: 'global' | 'repo' | 'linked-repo' | 'extra-folder';
    skills: Skill[];
    repoId?: string;
    isRemovable: boolean;
}

export function groupSkillsByFolder(
    skills: Skill[],
    repoById: Map<string, any>,
): SkillFolderGroup[] {
    const groups: SkillFolderGroup[] = [];

    // 1. Global group
    const globalSkills = skills.filter(s => s.source === 'global');
    if (globalSkills.length > 0) {
        groups.push({
            key: 'global',
            label: '🌐 Global',
            folderPath: globalSkills[0].folderPath ?? '',
            source: 'global',
            skills: globalSkills,
            isRemovable: false,
        });
    }

    // 2. Repo group (local .github/skills)
    const repoSkills = skills.filter(s => s.source === 'repo' || (!s.source && !s.sourceRepoId));
    if (repoSkills.length > 0) {
        groups.push({
            key: 'repo',
            label: '📁 .github/skills',
            folderPath: repoSkills[0].folderPath ?? '',
            source: 'repo',
            skills: repoSkills,
            isRemovable: false,
        });
    }

    // 3. Extra groups — one per unique folderPath
    const extraSkills = skills.filter(s => s.source === 'linked-repo' || s.source === 'extra-folder');
    const seenFolders = new Set<string>();
    for (const skill of extraSkills) {
        const folder = skill.folderPath ?? skill.sourceRepoId ?? '';
        if (seenFolders.has(folder)) continue;
        seenFolders.add(folder);

        const groupSkills = extraSkills.filter(
            s => (s.folderPath ?? s.sourceRepoId ?? '') === folder,
        );
        const repoId = skill.sourceRepoId;
        const ws = repoId ? repoById.get(repoId) : undefined;

        let label: string;
        if (ws) {
            label = `📂 ${ws.name}`;
        } else {
            label = `📂 ${folder}`;
        }

        groups.push({
            key: folder,
            label,
            folderPath: folder,
            source: skill.source as 'linked-repo' | 'extra-folder',
            skills: groupSkills,
            repoId,
            isRemovable: true,
        });
    }

    return groups;
}

// ============================================================================
// SkillFolderSection
// ============================================================================

interface SkillFolderSectionProps {
    group: SkillFolderGroup;
    expandedSkill: string | null;
    skillDetail: SkillDetail | null;
    detailLoading: boolean;
    deleteConfirm: string | null;
    isSkillEnabled: (name: string) => boolean;
    skillToggleSaving: boolean;
    skillsLoading: boolean;
    onExpandSkill: (name: string) => void;
    onSkillToggle: (name: string, enabled: boolean) => void;
    onDeleteSkill: (name: string) => void;
    onSetDeleteConfirm: (name: string | null) => void;
    onUnlinkRepo?: () => void;
    onRemoveFolder?: () => void;
}

function SkillFolderSection({
    group,
    expandedSkill,
    skillDetail,
    detailLoading,
    deleteConfirm,
    isSkillEnabled,
    skillToggleSaving,
    skillsLoading,
    onExpandSkill,
    onSkillToggle,
    onDeleteSkill,
    onSetDeleteConfirm,
    onUnlinkRepo,
    onRemoveFolder,
}: SkillFolderSectionProps) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded" data-testid={`skill-folder-group-${group.key}`}>
            {/* Section header */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f5f5f5] dark:bg-[#2a2a2a] rounded-t">
                <button
                    className="flex-1 flex items-center gap-1.5 text-left min-w-0"
                    onClick={() => setCollapsed(c => !c)}
                    data-testid={`skill-folder-toggle-${group.key}`}
                >
                    <span className="text-[10px] text-[#848484]">{collapsed ? '▶' : '▼'}</span>
                    <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate">{group.label}</span>
                    <span className="text-[10px] text-[#848484] flex-shrink-0">
                        ({group.skills.length} skill{group.skills.length !== 1 ? 's' : ''})
                    </span>
                </button>
                {group.isRemovable && (
                    onUnlinkRepo ? (
                        <button
                            className="text-[10px] text-[#848484] hover:text-red-600 dark:hover:text-red-400 flex-shrink-0 px-1"
                            title="Unlink this repo's skills"
                            onClick={onUnlinkRepo}
                            data-testid={`skill-folder-unlink-${group.key}`}
                        >✕ Unlink</button>
                    ) : onRemoveFolder ? (
                        <button
                            className="text-[10px] text-[#848484] hover:text-red-600 dark:hover:text-red-400 flex-shrink-0 px-1"
                            title="Remove this folder"
                            onClick={onRemoveFolder}
                            data-testid={`skill-folder-remove-${group.key}`}
                        >✕ Remove</button>
                    ) : null
                )}
            </div>
            {/* Skills list */}
            {!collapsed && (
                <ul className="flex flex-col divide-y divide-[#e0e0e0] dark:divide-[#3c3c3c]" data-testid={`skill-folder-list-${group.key}`}>
                    {group.skills.length === 0 ? (
                        <li className="px-3 py-2 text-xs text-[#848484] italic">(empty)</li>
                    ) : group.skills.map(skill => (
                        <SkillListItem
                            key={skill.name}
                            skill={skill}
                            isExpanded={expandedSkill === skill.name}
                            isEnabled={isSkillEnabled(skill.name)}
                            detail={skillDetail}
                            detailLoading={detailLoading}
                            deleteConfirm={deleteConfirm === skill.name}
                            onExpand={() => onExpandSkill(skill.name)}
                            onToggle={(enabled) => onSkillToggle(skill.name, enabled)}
                            onDelete={() => onDeleteSkill(skill.name)}
                            onSetDeleteConfirm={(c) => onSetDeleteConfirm(c ? skill.name : null)}
                            toggleDisabled={skillToggleSaving || skillsLoading}
                            testIdPrefix="skill"
                            hideDelete={skill.source === 'linked-repo' || skill.source === 'global'}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}


export function AgentSkillsPanel({
    workspaceId,
    skills,
    skillsLoading,
    disabledSkills,
    skillToggleSaving,
    expandedSkill,
    skillDetail,
    detailLoading,
    deleteConfirm,
    onExpandSkill,
    onDeleteSkill,
    onSkillToggle,
    onSetDeleteConfirm,
    onInstalled,
    extraSkillFolders = [],
    onExtraSkillFoldersChange,
    linkedRepoIds = [],
    onLinkedRepoIdsChange,
    allRepos = [],
}: AgentSkillsPanelProps) {
    const [showInstallDialog, setShowInstallDialog] = useState(false);
    const [newFolderInput, setNewFolderInput] = useState('');
    const [showRepoPicker, setShowRepoPicker] = useState(false);

    const isSkillEnabled = (name: string) => !disabledSkills.includes(name);

    // Build a map: repoId → workspace for quick lookup of name/color
    const repoById = new Map<string, any>(
        allRepos.map(r => [r.workspace.id, r.workspace])
    );

    // Determine if a folder entry is a linked repo and which one
    function getLinkedRepoForFolder(folder: string): { id: string; ws: any } | null {
        for (const id of linkedRepoIds) {
            const ws = repoById.get(id);
            if (!ws) continue;
            const expectedPath = `${ws.rootPath}/.github/skills`.replace(/\\/g, '/');
            const normalizedFolder = folder.replace(/\\/g, '/');
            if (normalizedFolder === expectedPath || normalizedFolder === expectedPath.replace(/\//g, '\\')) {
                return { id, ws };
            }
        }
        return null;
    }

    // Source repo lookup for skills
    function getSourceRepoName(skill: Skill): string | undefined {
        if (!skill.sourceRepoId) return undefined;
        const ws = repoById.get(skill.sourceRepoId);
        return ws?.name;
    }

    const handleLinkRepo = async (linkedWs: any) => {
        // Fetch skills-path for the other repo
        try {
            const data = await getSpaCocClient().skills.getWorkspacePath(linkedWs.id);
            const skillsPath: string = data.path;

            // Add to extraSkillFolders if not already there
            if (!extraSkillFolders.includes(skillsPath)) {
                onExtraSkillFoldersChange?.([...extraSkillFolders, skillsPath]);
            }
            // Add to linkedRepoIds
            if (!linkedRepoIds.includes(linkedWs.id)) {
                onLinkedRepoIdsChange?.([...linkedRepoIds, linkedWs.id]);
            }
        } catch {
            // ignore
        }
        setShowRepoPicker(false);
    };

    const handleUnlinkRepo = (repoId: string) => {
        const ws = repoById.get(repoId);
        if (!ws) return;
        const expectedPath = `${ws.rootPath}/.github/skills`;
        // Remove from extra folders
        const nextFolders = extraSkillFolders.filter(f =>
            f.replace(/\\/g, '/') !== expectedPath.replace(/\\/g, '/')
        );
        onExtraSkillFoldersChange?.(nextFolders);
        onLinkedRepoIdsChange?.(linkedRepoIds.filter(id => id !== repoId));
    };

    // Other repos that can be linked (not current workspace)
    const otherRepos = allRepos.filter(r => r.workspace.id !== workspaceId);

    // Build folder groups from the skills array
    const skillGroups = groupSkillsByFolder(skills, repoById);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[#848484] flex-1 min-w-0">
                    AI prompt modules stored in <code className="font-mono bg-[#f3f3f3] dark:bg-[#333] px-1 rounded">.github/skills/</code>
                </p>
                <Button variant="primary" size="sm" onClick={() => setShowInstallDialog(true)} data-testid="skills-install-btn">
                    + Install
                </Button>
            </div>

            {skillsLoading ? (
                <div className="text-xs text-[#848484]">Loading...</div>
            ) : skills.length === 0 ? (
                <div className="empty-state flex flex-col items-center justify-center py-12 gap-3 text-center" data-testid="skills-empty-state">
                    <div className="text-3xl">🧩</div>
                    <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">No skills installed</div>
                    <div className="text-xs text-[#848484] max-w-xs">
                        Skills are AI prompt modules stored in <code className="font-mono">.github/skills/</code>.
                        They extend Copilot's capabilities for specific tasks.
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => setShowInstallDialog(true)}>
                        + Install Skills
                    </Button>
                    {otherRepos.length > 0 && (
                        <button
                            className="text-xs text-[#0078d4] hover:underline mt-1"
                            onClick={() => setShowRepoPicker(true)}
                            data-testid="empty-state-link-repo-btn"
                        >
                            Have skills in another repo? Link from another repo →
                        </button>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-3" data-testid="skills-list">
                    {skillGroups.map(group => (
                        <SkillFolderSection
                            key={group.key}
                            group={group}
                            expandedSkill={expandedSkill}
                            skillDetail={skillDetail}
                            detailLoading={detailLoading}
                            deleteConfirm={deleteConfirm}
                            isSkillEnabled={isSkillEnabled}
                            skillToggleSaving={skillToggleSaving}
                            skillsLoading={skillsLoading}
                            onExpandSkill={onExpandSkill}
                            onSkillToggle={onSkillToggle}
                            onDeleteSkill={onDeleteSkill}
                            onSetDeleteConfirm={onSetDeleteConfirm}
                            onUnlinkRepo={group.repoId ? () => handleUnlinkRepo(group.repoId!) : undefined}
                            onRemoveFolder={group.isRemovable && !group.repoId ? () => {
                                onExtraSkillFoldersChange?.(extraSkillFolders.filter(f => f !== group.folderPath));
                            } : undefined}
                        />
                    ))}
                </div>
            )}

            {showInstallDialog && (
                <InstallSkillsDialog
                    workspaceId={workspaceId}
                    onClose={() => setShowInstallDialog(false)}
                    onInstalled={() => { setShowInstallDialog(false); onInstalled(); }}
                />
            )}

            {/* ── Extra Skill Folders ── */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-4" data-testid="extra-skill-folders-section">
                <h3 className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-0.5">Extra Skill Folders</h3>
                <p className="text-xs text-[#848484] mb-3">
                    Searched after <code className="font-mono bg-[#f3f3f3] dark:bg-[#333] px-1 rounded">.github/skills/</code> and global, in order:
                </p>

                {extraSkillFolders.length > 0 && (
                    <ul className="flex flex-col gap-1 mb-3" data-testid="extra-skill-folders-list">
                        {extraSkillFolders.map((folder, idx) => {
                            const linked = getLinkedRepoForFolder(folder);
                            return (
                                <li key={idx} className="flex items-center gap-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                                    <span className="w-4 text-right text-[#848484] flex-shrink-0">{idx + 1}</span>
                                    {linked ? (
                                        <span
                                            className="flex-1 flex items-center gap-1.5 bg-[#f3f3f3] dark:bg-[#2a2a2a] px-2 py-1 rounded overflow-hidden"
                                            title={folder}
                                            data-testid={`extra-folder-path-${idx}`}
                                        >
                                            {linked.ws.color && (
                                                <span
                                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                                    style={{ backgroundColor: linked.ws.color }}
                                                />
                                            )}
                                            <span className="font-medium truncate">📂 {linked.ws.name}</span>
                                            <span className="font-mono text-[#848484] text-[10px] truncate hidden sm:inline">{folder}</span>
                                        </span>
                                    ) : (
                                        <span
                                            className="flex-1 font-mono truncate bg-[#f3f3f3] dark:bg-[#2a2a2a] px-2 py-1 rounded"
                                            title={folder}
                                            data-testid={`extra-folder-path-${idx}`}
                                        >{folder}</span>
                                    )}
                                    <button
                                        className="px-1 py-0.5 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-40"
                                        title="Move up"
                                        disabled={idx === 0}
                                        onClick={() => {
                                            const next = [...extraSkillFolders];
                                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                                            onExtraSkillFoldersChange?.(next);
                                        }}
                                        data-testid={`extra-folder-up-${idx}`}
                                    >↑</button>
                                    <button
                                        className="px-1 py-0.5 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-40"
                                        title="Move down"
                                        disabled={idx === extraSkillFolders.length - 1}
                                        onClick={() => {
                                            const next = [...extraSkillFolders];
                                            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                                            onExtraSkillFoldersChange?.(next);
                                        }}
                                        data-testid={`extra-folder-down-${idx}`}
                                    >↓</button>
                                    <button
                                        className="px-1 py-0.5 text-[#848484] hover:text-red-600 dark:hover:text-red-400"
                                        title="Remove"
                                        onClick={() => {
                                            if (linked) {
                                                handleUnlinkRepo(linked.id);
                                            } else {
                                                onExtraSkillFoldersChange?.(extraSkillFolders.filter((_, i) => i !== idx));
                                            }
                                        }}
                                        data-testid={`extra-folder-remove-${idx}`}
                                    >✕</button>
                                </li>
                            );
                        })}
                    </ul>
                )}

                <div className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 text-xs font-mono border border-[#e0e0e0] dark:border-[#3c3c3c] rounded px-2 py-1 bg-[#ffffff] dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] placeholder-[#848484]"
                        placeholder="/enter/a/path/here"
                        value={newFolderInput}
                        onChange={e => setNewFolderInput(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && newFolderInput.trim()) {
                                onExtraSkillFoldersChange?.([...extraSkillFolders, newFolderInput.trim()]);
                                setNewFolderInput('');
                            }
                        }}
                        data-testid="extra-folder-input"
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!newFolderInput.trim()}
                        onClick={() => {
                            if (newFolderInput.trim()) {
                                onExtraSkillFoldersChange?.([...extraSkillFolders, newFolderInput.trim()]);
                                setNewFolderInput('');
                            }
                        }}
                        data-testid="extra-folder-add-btn"
                    >+ Add</Button>
                    {otherRepos.length > 0 && (
                        <div className="relative">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setShowRepoPicker(v => !v)}
                                data-testid="link-from-repo-btn"
                            >🔗 Link from repo ▾</Button>
                            {showRepoPicker && (
                                <LinkFromRepoPopover
                                    repos={otherRepos}
                                    linkedRepoIds={linkedRepoIds}
                                    onLink={handleLinkRepo}
                                    onUnlink={handleUnlinkRepo}
                                    onClose={() => setShowRepoPicker(false)}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// LinkFromRepoPopover
// ============================================================================

interface LinkFromRepoPopoverProps {
    repos: RepoData[];
    linkedRepoIds: string[];
    onLink: (ws: any) => void;
    onUnlink: (repoId: string) => void;
    onClose: () => void;
}

interface RepoSkillsInfo {
    skillCount: number;
    accessible: boolean;
    loading: boolean;
}

function LinkFromRepoPopover({ repos, linkedRepoIds, onLink, onUnlink, onClose }: LinkFromRepoPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const [skillsInfo, setSkillsInfo] = useState<Record<string, RepoSkillsInfo>>({});
    const [filterText, setFilterText] = useState('');

    // Close on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    // Fetch skill counts for all repos when popover opens
    useEffect(() => {
        for (const r of repos) {
            const id = r.workspace.id;
            getSpaCocClient().skills.getWorkspacePath(id)
                .then(data => {
                    setSkillsInfo(prev => ({
                        ...prev,
                        [id]: {
                            skillCount: data?.skillCount ?? 0,
                            accessible: data?.accessible ?? false,
                            loading: false,
                        },
                    }));
                })
                .catch(() => {
                    setSkillsInfo(prev => ({
                        ...prev,
                        [id]: { skillCount: 0, accessible: false, loading: false },
                    }));
                });
            setSkillsInfo(prev => ({ ...prev, [id]: { skillCount: 0, accessible: false, loading: true } }));
        }
    }, [repos]);

    const showFilter = repos.length > 8;
    const filtered = filterText
        ? repos.filter(r =>
            r.workspace.name.toLowerCase().includes(filterText.toLowerCase()) ||
            (r.workspace.remoteUrl || '').toLowerCase().includes(filterText.toLowerCase())
        )
        : repos;

    return (
        <div
            ref={popoverRef}
            className="absolute right-0 bottom-full mb-1 z-50 bg-white dark:bg-[#252526] rounded-lg shadow-xl border border-[#e0e0e0] dark:border-[#3c3c3c] w-72 overflow-hidden"
            data-testid="link-from-repo-popover"
        >
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Link skills from another repo</div>
            </div>
            {showFilter && (
                <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <input
                        autoFocus
                        type="text"
                        className="w-full text-xs px-2 py-1 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] placeholder-[#848484]"
                        placeholder="Filter repos..."
                        value={filterText}
                        onChange={e => setFilterText(e.target.value)}
                        data-testid="repo-picker-filter"
                    />
                </div>
            )}
            <div className="max-h-[280px] overflow-y-auto">
                {filtered.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-[#848484] text-center">No repos found</div>
                ) : filtered.map(r => {
                    const ws = r.workspace;
                    const isLinked = linkedRepoIds.includes(ws.id);
                    const info = skillsInfo[ws.id];
                    const remoteDisplay = ws.remoteUrl || ws.rootPath || '';
                    const truncatedRemote = remoteDisplay.length > 45
                        ? '...' + remoteDisplay.slice(-42)
                        : remoteDisplay;

                    return (
                        <button
                            key={ws.id}
                            className={`w-full text-left px-3 py-2.5 hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] border-b border-[#f0f0f0] dark:border-[#333] last:border-0 flex items-start gap-2 ${isLinked ? 'opacity-70' : ''}`}
                            onClick={() => isLinked ? onUnlink(ws.id) : onLink(ws)}
                            data-testid={`repo-picker-item-${ws.id}`}
                        >
                            {isLinked ? (
                                <span className="text-[#0078d4] flex-shrink-0 mt-0.5 text-xs">✓</span>
                            ) : ws.color ? (
                                <span
                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                                    style={{ backgroundColor: ws.color }}
                                />
                            ) : (
                                <span className="w-2.5 h-2.5 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                        {ws.name}
                                        {isLinked && <span className="ml-1 text-[10px] text-[#848484]">(linked)</span>}
                                    </span>
                                    <span className="text-[10px] text-[#848484] flex-shrink-0">
                                        {info?.loading ? '...' : `${info?.skillCount ?? 0} skills`}
                                    </span>
                                </div>
                                {truncatedRemote && (
                                    <div className="text-[10px] text-[#848484] truncate mt-0.5">{truncatedRemote}</div>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ============================================================================
// InstallSkillsDialog
// ============================================================================

interface InstallSkillsDialogProps {
    workspaceId: string;
    onClose: () => void;
    onInstalled: () => void;
}

function InstallSkillsDialog({ workspaceId, onClose, onInstalled }: InstallSkillsDialogProps) {
    const { addToast } = useGlobalToast();
    const [source, setSource] = useState<InstallSource>('bundled');
    const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
    const [selectedBundled, setSelectedBundled] = useState<Set<string>>(new Set());
    const [loadingBundled, setLoadingBundled] = useState(false);
    const [githubUrl, setGithubUrl] = useState('');
    const [scanResult, setScanResult] = useState<any>(null);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState('');
    const [selectedGithub, setSelectedGithub] = useState<Set<string>>(new Set());
    const [installing, setInstalling] = useState(false);

    useEffect(() => {
        if (source !== 'bundled') return;
        setLoadingBundled(true);
        getSpaCocClient().skills.listBundledWorkspace(workspaceId)
            .then(skills => {
                setBundledSkills(skills as BundledSkill[]);
                setSelectedBundled(new Set(skills.filter(s => !s.alreadyExists).map(s => s.name)));
            })
            .catch(() => {})
            .finally(() => setLoadingBundled(false));
    }, [workspaceId, source]);

    const handleScan = async () => {
        setScanError('');
        setScanResult(null);
        setSelectedGithub(new Set());
        setScanning(true);
        try {
            const data = await getSpaCocClient().skills.scanWorkspace(workspaceId, { url: githubUrl });
            if (!data.success) {
                setScanError(data.error || 'Scan failed');
            } else {
                setScanResult(data);
                setSelectedGithub(new Set(data.skills.map((s: any) => s.name)));
            }
        } catch (err: any) {
            setScanError(getSpaCocClientErrorMessage(err, 'Scan failed'));
        } finally {
            setScanning(false);
        }
    };

    const handleInstall = async () => {
        setInstalling(true);
        try {
            let body: any;
            if (source === 'bundled') {
                body = { source: 'bundled', skills: Array.from(selectedBundled) };
            } else {
                const skillsToInstall = scanResult?.skills?.filter((s: any) => selectedGithub.has(s.name)) ?? [];
                body = { url: githubUrl, skillsToInstall };
            }

            const result = await getSpaCocClient().skills.installWorkspace(workspaceId, body);
            const installed = result.installed ?? 0;
            const failed = result.failed ?? 0;
            if (failed > 0) {
                addToast(`${installed} skill(s) installed, ${failed} failed`, 'error');
            } else {
                addToast(`${installed} skill(s) installed successfully`, 'success');
            }
            onInstalled();
        } catch (err: any) {
            addToast(getSpaCocClientErrorMessage(err, 'Installation failed'), 'error');
        } finally {
            setInstalling(false);
        }
    };

    const canInstall = source === 'bundled'
        ? selectedBundled.size > 0
        : selectedGithub.size > 0;

    return (
        <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            data-testid="install-skills-dialog"
        >
            <div className="bg-white dark:bg-[#252526] rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Install Skills</h3>
                    <button onClick={onClose} className="text-[#616161] hover:text-[#1e1e1e] dark:text-[#999] dark:hover:text-[#cccccc]" data-testid="install-dialog-close">×</button>
                </div>

                <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="text-xs font-medium text-[#616161] dark:text-[#999] mb-2">Source</div>
                    <div className="flex gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                            <input type="radio" value="bundled" checked={source === 'bundled'} onChange={() => setSource('bundled')} />
                            Built-in skills
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                            <input type="radio" value="github" checked={source === 'github'} onChange={() => setSource('github')} />
                            GitHub URL
                        </label>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3">
                    {source === 'bundled' ? (
                        loadingBundled ? (
                            <div className="text-xs text-[#848484]">Loading bundled skills...</div>
                        ) : bundledSkills.length === 0 ? (
                            <div className="text-xs text-[#848484]">No bundled skills available.</div>
                        ) : (
                            <ul className="flex flex-col gap-2">
                                {bundledSkills.map(skill => (
                                    <li key={skill.name} className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            id={`bundled-${skill.name}`}
                                            checked={selectedBundled.has(skill.name)}
                                            onChange={e => {
                                                setSelectedBundled(prev => {
                                                    const next = new Set(prev);
                                                    if (e.target.checked) next.add(skill.name);
                                                    else next.delete(skill.name);
                                                    return next;
                                                });
                                            }}
                                            className="mt-0.5"
                                        />
                                        <label htmlFor={`bundled-${skill.name}`} className="flex-1 cursor-pointer">
                                            <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc] flex items-center gap-2">
                                                {skill.name}
                                                {skill.alreadyExists && (
                                                    <span className="text-[10px] text-[#848484] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded-full">installed</span>
                                                )}
                                            </div>
                                            {skill.description && (
                                                <div className="text-xs text-[#616161] dark:text-[#999]">{skill.description}</div>
                                            )}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : (
                        <div className="flex flex-col gap-3">
                            <div>
                                <label className="text-xs font-medium text-[#616161] dark:text-[#999] block mb-1">GitHub URL</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={githubUrl}
                                        onChange={e => setGithubUrl(e.target.value)}
                                        placeholder="https://github.com/owner/repo/tree/main/skills"
                                        disabled={scanning}
                                        className="flex-1 text-xs px-2 py-1.5 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] placeholder-[#848484] focus:outline-none focus:border-[#0078d4]"
                                        onKeyDown={e => { if (e.key === 'Enter' && githubUrl) handleScan(); }}
                                        data-testid="github-url-input"
                                    />
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleScan}
                                        disabled={!githubUrl || scanning}
                                        data-testid="scan-btn"
                                    >
                                        {scanning ? '...' : 'Scan'}
                                    </Button>
                                </div>
                                {scanError && (
                                    <div className="text-xs text-red-600 dark:text-red-400 mt-1" data-testid="scan-error">{scanError}</div>
                                )}
                            </div>
                            {scanResult && scanResult.skills?.length > 0 && (
                                <ul className="flex flex-col gap-2">
                                    {scanResult.skills.map((skill: any) => (
                                        <li key={skill.name} className="flex items-start gap-2">
                                            <input
                                                type="checkbox"
                                                id={`github-${skill.name}`}
                                                checked={selectedGithub.has(skill.name)}
                                                onChange={e => {
                                                    setSelectedGithub(prev => {
                                                        const next = new Set(prev);
                                                        if (e.target.checked) next.add(skill.name);
                                                        else next.delete(skill.name);
                                                        return next;
                                                    });
                                                }}
                                                className="mt-0.5"
                                            />
                                            <label htmlFor={`github-${skill.name}`} className="flex-1 cursor-pointer">
                                                <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc] flex items-center gap-2">
                                                    {skill.name}
                                                    {skill.alreadyExists && (
                                                        <span className="text-[10px] text-[#f59e0b] bg-[#fef3c7] dark:bg-[#3c2e00] px-1.5 py-0.5 rounded-full">will replace</span>
                                                    )}
                                                </div>
                                                {skill.description && (
                                                    <div className="text-xs text-[#616161] dark:text-[#999]">{skill.description}</div>
                                                )}
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <Button variant="secondary" size="sm" onClick={onClose} data-testid="install-dialog-cancel">Cancel</Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleInstall}
                        disabled={!canInstall || installing}
                        data-testid="install-dialog-submit"
                    >
                        {installing ? 'Installing...' : `Install (${source === 'bundled' ? selectedBundled.size : selectedGithub.size})`}
                    </Button>
                </div>
            </div>
        </div>
    );
}
