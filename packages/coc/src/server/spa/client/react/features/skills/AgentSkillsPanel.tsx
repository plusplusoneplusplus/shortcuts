/**
 * AgentSkillsPanel — Repo Settings > Agent Skills tab.
 *
 * Visuals follow the redesigned spec in `agent-skills-redesign.css`. Layout:
 *   - Page header (breadcrumb, title, lede, Refresh + Install actions)
 *   - Toolbar (search, status chips, Link a repo)
 *   - Body grid (Sources rail + Skill list with cards + Resolution order)
 *
 * Behaviour: install, enable/disable, expand, delete, link-from-repo, extra
 * folder management. Logic is preserved from the previous implementation; only
 * the visual layout has changed.
 */

import './agent-skills-redesign.css';

import {
    useState,
    useEffect,
    useRef,
    useMemo,
    type ReactNode,
    type SVGProps,
} from 'react';
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
    /** Optional workspace name used in the breadcrumb. */
    workspaceName?: string;
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
    linkedRepoIds?: string[];
    onLinkedRepoIdsChange?: (ids: string[]) => void;
    allRepos?: RepoData[];
}

// ============================================================================
// Icons — Lucide-style hairlines (1.75 stroke), 14×14 inline SVGs
// ============================================================================

type IconProps = SVGProps<SVGSVGElement>;

function makeIcon(d: ReactNode, fill: 'none' | 'currentColor' = 'none') {
    return function Icon(props: IconProps) {
        const { className = 'ask-icon', ...rest } = props;
        return (
            <svg
                viewBox="0 0 24 24"
                fill={fill}
                stroke={fill === 'none' ? 'currentColor' : 'none'}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={className}
                aria-hidden
                {...rest}
            >
                {d}
            </svg>
        );
    };
}

const I = {
    search: makeIcon(<>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
    </>),
    plus: makeIcon(<>
        <path d="M12 5v14M5 12h14" />
    </>),
    filter: makeIcon(<>
        <path d="M3 6h18M6 12h12M10 18h4" />
    </>),
    more: makeIcon(<>
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
    </>, 'currentColor'),
    link: makeIcon(<>
        <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
        <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </>),
    file: makeIcon(<>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
    </>),
    folder: makeIcon(<>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>),
    clock: makeIcon(<>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
    </>),
    trash: makeIcon(<>
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </>),
    globe: makeIcon(<>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>),
    grip: makeIcon(<>
        <circle cx="9" cy="6" r="1.4" />
        <circle cx="9" cy="12" r="1.4" />
        <circle cx="9" cy="18" r="1.4" />
        <circle cx="15" cy="6" r="1.4" />
        <circle cx="15" cy="12" r="1.4" />
        <circle cx="15" cy="18" r="1.4" />
    </>, 'currentColor'),
    zap: makeIcon(<>
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </>),
    refresh: makeIcon(<>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
    </>),
    x: makeIcon(<>
        <path d="M18 6 6 18M6 6l12 12" />
    </>),
    chevron: makeIcon(<>
        <path d="m9 6 6 6-6 6" />
    </>),
};

// ============================================================================
// Folder Grouping (preserved API — used by external tests)
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

    const repoSkills = skills.filter(
        s => s.source === 'repo' || (!s.source && !s.sourceRepoId),
    );
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

    const extraSkills = skills.filter(
        s => s.source === 'linked-repo' || s.source === 'extra-folder',
    );
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
        const label = ws ? `📂 ${ws.name}` : `📂 ${folder}`;

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
// Source rail helpers
// ============================================================================

type SourceKind = 'all' | 'repo' | 'global' | 'linked' | 'extra';

interface SourceItem {
    id: string;
    kind: SourceKind;
    name: string;
    path: string;
    count: number;
    removable: boolean;
    repoColor?: string;
    repoId?: string;
    folderPath?: string;
}

function buildSources(
    skills: Skill[],
    skillGroups: SkillFolderGroup[],
    repoById: Map<string, any>,
): SourceItem[] {
    const items: SourceItem[] = [
        {
            id: 'all',
            kind: 'all',
            name: 'All skills',
            path: '',
            count: skills.length,
            removable: false,
        },
    ];

    for (const group of skillGroups) {
        if (group.source === 'repo') {
            items.push({
                id: 'group:repo',
                kind: 'repo',
                name: 'This repository',
                path: '.github/skills/',
                count: group.skills.length,
                removable: false,
                folderPath: group.folderPath,
            });
        } else if (group.source === 'global') {
            items.push({
                id: 'group:global',
                kind: 'global',
                name: 'Global',
                path: '~/.coc/skills/',
                count: group.skills.length,
                removable: false,
                folderPath: group.folderPath,
            });
        } else if (group.source === 'linked-repo') {
            const ws = group.repoId ? repoById.get(group.repoId) : undefined;
            items.push({
                id: `group:${group.key}`,
                kind: 'linked',
                name: ws?.name ?? group.folderPath,
                path: group.folderPath,
                count: group.skills.length,
                removable: true,
                repoColor: ws?.color,
                repoId: group.repoId,
                folderPath: group.folderPath,
            });
        } else {
            items.push({
                id: `group:${group.key}`,
                kind: 'extra',
                name: group.folderPath.split(/[\\/]/).filter(Boolean).pop() || group.folderPath,
                path: group.folderPath,
                count: group.skills.length,
                removable: true,
                folderPath: group.folderPath,
            });
        }
    }

    return items;
}

function getSkillKind(skill: Skill): SourceKind {
    const s = skill.source;
    if (s === 'global') return 'global';
    if (s === 'linked-repo') return 'linked';
    if (s === 'extra-folder') return 'extra';
    return 'repo';
}

// ============================================================================
// Sources rail row
// ============================================================================

interface SourceRowProps {
    source: SourceItem;
    active: boolean;
    onClick: () => void;
    onRemove?: () => void;
}

function SourceRow({ source, active, onClick, onRemove }: SourceRowProps) {
    return (
        <button
            type="button"
            className={`ask-source ${active ? 'active' : ''}`}
            data-kind={source.kind}
            onClick={onClick}
            data-testid={`source-${source.id}`}
        >
            <span
                className="ask-swatch"
                style={source.kind === 'linked' && source.repoColor ? { background: source.repoColor } : undefined}
            />
            <div className="ask-source-meta">
                <span className="ask-name">{source.name}</span>
                {source.path && <span className="ask-path">{source.path}</span>}
            </div>
            <span className="ask-count">{source.count}</span>
            {onRemove && source.removable && (
                <span
                    role="button"
                    tabIndex={0}
                    className="ask-source-remove"
                    title="Remove this source"
                    onClick={e => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation();
                            onRemove();
                        }
                    }}
                >
                    <I.x className="ask-icon" style={{ width: 10, height: 10 }} />
                </span>
            )}
        </button>
    );
}

// ============================================================================
// SkillCard — collapsed + expanded
// ============================================================================

interface SkillCardProps {
    skill: Skill;
    detail: SkillDetail | null;
    detailLoading: boolean;
    isOpen: boolean;
    isEnabled: boolean;
    deleteConfirming: boolean;
    sourceLabel: string;
    sourceKind: SourceKind;
    sourcePillLabel: string;
    hideDelete: boolean;
    toggleDisabled: boolean;
    onToggleOpen: () => void;
    onToggleEnabled: (next: boolean) => void;
    onSetDeleteConfirm: (confirming: boolean) => void;
    onDelete: () => void;
}

function SkillCard({
    skill,
    detail,
    detailLoading,
    isOpen,
    isEnabled,
    deleteConfirming,
    sourceLabel,
    sourceKind,
    sourcePillLabel,
    hideDelete,
    toggleDisabled,
    onToggleOpen,
    onToggleEnabled,
    onSetDeleteConfirm,
    onDelete,
}: SkillCardProps) {
    const effectiveDetail = detail?.name === skill.name ? detail : skill;
    const triggers = effectiveDetail.variables ?? [];
    const files = useMemo(() => {
        const refs = effectiveDetail.references ?? [];
        const scripts = effectiveDetail.scripts ?? [];
        return [...refs, ...scripts];
    }, [effectiveDetail.references, effectiveDetail.scripts]);
    const updatedRelative = (effectiveDetail as Skill & { updatedRelative?: string }).updatedRelative;

    return (
        <article
            className={`ask-skill ${isOpen ? 'is-open' : ''} ${isEnabled ? '' : 'is-disabled'}`}
            data-source={sourceKind}
            data-testid={`skill-item-${skill.name}`}
        >
            <div
                className="ask-skill-head"
                onClick={onToggleOpen}
                data-testid={`skill-expand-${skill.name}`}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggleOpen();
                    }
                }}
            >
                <span className="ask-skill-spine" />
                <div className="ask-skill-body">
                    <div className="ask-skill-top">
                        <I.chevron
                            className="ask-icon"
                            style={{
                                transform: `rotate(${isOpen ? 90 : 0}deg)`,
                                transition: 'transform .15s',
                            }}
                        />
                        <span className="ask-name">{skill.name}</span>
                        {skill.version && (
                            <span className="ask-version">v{skill.version}</span>
                        )}
                        <span className="ask-src-pill" data-kind={sourceKind}>
                            <span className="ask-dot" />
                            {sourcePillLabel}
                        </span>
                        {!isEnabled && (
                            <span className="ask-src-pill ask-pill-warn">Disabled</span>
                        )}
                    </div>
                    {skill.description && (
                        <div className="ask-skill-desc">{skill.description}</div>
                    )}
                    {(files.length > 0 || triggers.length > 0) && (
                        <div className="ask-skill-meta">
                            {files.length > 0 && (
                                <span>
                                    <I.file className="ask-icon" />
                                    {files.length} file{files.length === 1 ? '' : 's'}
                                </span>
                            )}
                            {updatedRelative && (
                                <span>
                                    <I.clock className="ask-icon" />
                                    Updated {updatedRelative}
                                </span>
                            )}
                            {triggers.length > 0 && (
                                <span className="ask-trigger">
                                    Triggers: <code>{triggers[0]}</code>
                                    {triggers.length > 1 && (
                                        <span style={{ color: 'var(--ask-text-3)' }}>
                                            {' +' + (triggers.length - 1)}
                                        </span>
                                    )}
                                </span>
                            )}
                        </div>
                    )}
                </div>
                <div
                    className="ask-skill-right"
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => e.stopPropagation()}
                >
                    <button
                        type="button"
                        className={`ask-toggle ${isEnabled ? 'on' : ''}`}
                        aria-pressed={isEnabled}
                        title={isEnabled ? 'Disable' : 'Enable'}
                        disabled={toggleDisabled}
                        onClick={() => onToggleEnabled(!isEnabled)}
                        data-testid={`skill-toggle-${skill.name}`}
                    />
                    <button
                        type="button"
                        className="ask-icon-btn"
                        title="Open SKILL.md"
                        aria-label="Open SKILL.md"
                    >
                        <I.file className="ask-icon" />
                    </button>
                    {!hideDelete && (
                        deleteConfirming ? (
                            <span className="ask-delete-confirm">
                                <span>Delete?</span>
                                <button
                                    type="button"
                                    className="ask-confirm-yes"
                                    onClick={onDelete}
                                    data-testid={`skill-delete-confirm-${skill.name}`}
                                >
                                    Yes
                                </button>
                                <button
                                    type="button"
                                    className="ask-confirm-no"
                                    onClick={() => onSetDeleteConfirm(false)}
                                >
                                    No
                                </button>
                            </span>
                        ) : (
                            <button
                                type="button"
                                className="ask-icon-btn ask-skill-delete"
                                title={`Delete ${skill.name}`}
                                aria-label={`Delete ${skill.name}`}
                                onClick={() => onSetDeleteConfirm(true)}
                                data-testid={`skill-delete-btn-${skill.name}`}
                            >
                                <I.trash className="ask-icon" />
                            </button>
                        )
                    )}
                    <button
                        type="button"
                        className="ask-icon-btn"
                        title="More"
                        aria-label="More options"
                    >
                        <I.more className="ask-icon" />
                    </button>
                </div>
            </div>

            {isOpen && (
                <div className="ask-skill-detail" data-testid="skill-detail-panel">
                    <div>
                        <h5>Description</h5>
                        <p>{detailLoading ? 'Loading…' : (effectiveDetail.description ?? 'No description.')}</p>

                        <h5>Triggers</h5>
                        <div className="ask-triggers">
                            {triggers.length > 0 ? (
                                triggers.map(t => (
                                    <span key={t} className="ask-trigger-pill">/{t}</span>
                                ))
                            ) : (
                                <span style={{ color: 'var(--ask-text-3)', fontSize: 12 }}>None declared</span>
                            )}
                        </div>

                        {effectiveDetail.output && effectiveDetail.output.length > 0 && (
                            <>
                                <h5>Output</h5>
                                <div className="ask-triggers">
                                    {effectiveDetail.output.map(o => (
                                        <span key={o} className="ask-trigger-pill">{o}</span>
                                    ))}
                                </div>
                            </>
                        )}

                        {effectiveDetail.promptBody && (
                            <>
                                <h5>Skill body — SKILL.md (preview)</h5>
                                <pre className="ask-codeblock">{effectiveDetail.promptBody}</pre>
                            </>
                        )}
                    </div>

                    <aside className="ask-aside">
                        <h5>Metadata</h5>
                        <div className="ask-row">
                            <span className="ask-k">Source</span>
                            <span className="ask-v">{sourceLabel}</span>
                        </div>
                        {effectiveDetail.version && (
                            <div className="ask-row">
                                <span className="ask-k">Version</span>
                                <span className="ask-v" data-testid="skill-detail-version">
                                    v{effectiveDetail.version}
                                </span>
                            </div>
                        )}
                        {files.length > 0 && (
                            <div className="ask-row">
                                <span className="ask-k">Files</span>
                                <span className="ask-v">{files.length}</span>
                            </div>
                        )}
                        {effectiveDetail.relativePath && (
                            <div className="ask-row">
                                <span className="ask-k">Path</span>
                                <span className="ask-v">{effectiveDetail.relativePath}</span>
                            </div>
                        )}

                        {files.length > 0 && (
                            <>
                                <h5 style={{ marginTop: 18 }}>Files</h5>
                                <div className="ask-file-list">
                                    {files.map(f => (
                                        <div key={f} className="ask-file-row">
                                            <I.file className="ask-icon ask-ico" />
                                            <span>{f}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}

                        {!hideDelete && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
                                <button type="button" className="ask-btn ask-sm">
                                    <I.file className="ask-icon" /> Open
                                </button>
                                <button
                                    type="button"
                                    className="ask-btn ask-sm ask-danger"
                                    onClick={() => onSetDeleteConfirm(true)}
                                >
                                    <I.trash className="ask-icon" /> Delete
                                </button>
                            </div>
                        )}
                    </aside>
                </div>
            )}
        </article>
    );
}

// ============================================================================
// Resolution order
// ============================================================================

interface ResolutionItem {
    id: string;
    kind: SourceKind;
    label: string;
    path: string;
    reorderable: boolean;
    onUp?: () => void;
    onDown?: () => void;
    upDisabled?: boolean;
    downDisabled?: boolean;
}

function ResolutionOrder({ items }: { items: ResolutionItem[] }) {
    if (items.length === 0) return null;
    return (
        <div className="ask-resolution" data-testid="skills-resolution-order">
            <h3>Resolution order</h3>
            <p>
                When two skills share a name, the first matching folder wins. Drag to reorder, or use the arrow buttons.
            </p>
            <div className="ask-order-list">
                {items.map((it, idx) => (
                    <div key={it.id} className="ask-order-row" data-kind={it.kind}>
                        <span className="ask-idx">{idx + 1}</span>
                        <span className="ask-swatch" />
                        <div className="ask-label">
                            <span className="ask-label-name">{it.label}</span>
                            <span className="ask-path">{it.path}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 2 }}>
                            <button
                                type="button"
                                className="ask-icon-btn"
                                title="Move up"
                                onClick={it.onUp}
                                disabled={!it.reorderable || it.upDisabled}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                className="ask-icon-btn"
                                title="Move down"
                                onClick={it.onDown}
                                disabled={!it.reorderable || it.downDisabled}
                            >
                                ↓
                            </button>
                            <button
                                type="button"
                                className="ask-icon-btn"
                                title="Drag"
                                style={{ cursor: it.reorderable ? 'grab' : 'default' }}
                                disabled={!it.reorderable}
                            >
                                <I.grip className="ask-icon" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ============================================================================
// AgentSkillsPanel
// ============================================================================

export function AgentSkillsPanel({
    workspaceId,
    workspaceName,
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
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'on' | 'off'>('all');
    const [activeSource, setActiveSource] = useState<string>('all');
    const [showInstallDialog, setShowInstallDialog] = useState(false);
    const [showRepoPicker, setShowRepoPicker] = useState(false);
    const [showAddFolder, setShowAddFolder] = useState(false);
    const [newFolderInput, setNewFolderInput] = useState('');

    const isSkillEnabled = (name: string) => !disabledSkills.includes(name);
    const enabledCount = useMemo(
        () => skills.filter(s => isSkillEnabled(s.name)).length,
        [skills, disabledSkills],
    );

    const repoById = useMemo(
        () => new Map<string, any>(allRepos.map(r => [r.workspace.id, r.workspace])),
        [allRepos],
    );

    const skillGroups = useMemo(
        () => groupSkillsByFolder(skills, repoById),
        [skills, repoById],
    );

    const sources = useMemo(
        () => buildSources(skills, skillGroups, repoById),
        [skills, skillGroups, repoById],
    );

    // Linked repo handling
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

    const handleLinkRepo = async (linkedWs: any) => {
        try {
            const data = await getSpaCocClient().skills.getWorkspacePath(linkedWs.id);
            const skillsPath: string = data.path;
            if (!extraSkillFolders.includes(skillsPath)) {
                onExtraSkillFoldersChange?.([...extraSkillFolders, skillsPath]);
            }
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
        const nextFolders = extraSkillFolders.filter(f =>
            f.replace(/\\/g, '/') !== expectedPath.replace(/\\/g, '/'),
        );
        onExtraSkillFoldersChange?.(nextFolders);
        onLinkedRepoIdsChange?.(linkedRepoIds.filter(id => id !== repoId));
    };

    const handleRemoveExtra = (folder: string) => {
        const linked = getLinkedRepoForFolder(folder);
        if (linked) {
            handleUnlinkRepo(linked.id);
        } else {
            onExtraSkillFoldersChange?.(extraSkillFolders.filter(f => f !== folder));
        }
    };

    const moveExtra = (folder: string, delta: -1 | 1) => {
        const idx = extraSkillFolders.indexOf(folder);
        if (idx < 0) return;
        const next = [...extraSkillFolders];
        const j = idx + delta;
        if (j < 0 || j >= next.length) return;
        [next[idx], next[j]] = [next[j], next[idx]];
        onExtraSkillFoldersChange?.(next);
    };

    const otherRepos = allRepos.filter(r => r.workspace.id !== workspaceId);

    // Filter skills based on active source + filter status + query
    const filteredSkills = useMemo(() => {
        let list = skills;
        if (activeSource !== 'all') {
            // Find which group the activeSource refers to
            const src = sources.find(s => s.id === activeSource);
            if (src) {
                if (src.kind === 'repo') {
                    list = list.filter(s => s.source === 'repo' || (!s.source && !s.sourceRepoId));
                } else if (src.kind === 'global') {
                    list = list.filter(s => s.source === 'global');
                } else if (src.kind === 'linked' || src.kind === 'extra') {
                    list = list.filter(s => (s.folderPath ?? '') === src.folderPath);
                }
            }
        }
        if (filterStatus === 'on') list = list.filter(s => isSkillEnabled(s.name));
        if (filterStatus === 'off') list = list.filter(s => !isSkillEnabled(s.name));
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(s =>
                s.name.toLowerCase().includes(q) ||
                (s.description?.toLowerCase().includes(q) ?? false) ||
                (s.variables?.some(v => v.toLowerCase().includes(q)) ?? false),
            );
        }
        return list;
    }, [skills, activeSource, sources, filterStatus, searchQuery, disabledSkills]);

    const clearFilters = () => {
        setSearchQuery('');
        setActiveSource('all');
        setFilterStatus('all');
    };

    // Resolution order items — all groups, but only extra folders are reorderable
    const resolutionItems: ResolutionItem[] = useMemo(() => {
        const list: ResolutionItem[] = [];
        for (const group of skillGroups) {
            if (group.source === 'repo') {
                list.push({
                    id: 'repo',
                    kind: 'repo',
                    label: 'This repository',
                    path: '.github/skills/',
                    reorderable: false,
                });
            } else if (group.source === 'global') {
                list.push({
                    id: 'global',
                    kind: 'global',
                    label: 'Global',
                    path: '~/.coc/skills/',
                    reorderable: false,
                });
            }
        }
        for (let i = 0; i < extraSkillFolders.length; i++) {
            const folder = extraSkillFolders[i];
            const linked = getLinkedRepoForFolder(folder);
            list.push({
                id: `extra:${i}`,
                kind: linked ? 'linked' : 'extra',
                label: linked ? linked.ws.name : folder.split(/[\\/]/).filter(Boolean).pop() || folder,
                path: folder,
                reorderable: true,
                onUp: () => moveExtra(folder, -1),
                onDown: () => moveExtra(folder, 1),
                upDisabled: i === 0,
                downDisabled: i === extraSkillFolders.length - 1,
            });
        }
        return list;
    }, [skillGroups, extraSkillFolders, linkedRepoIds, repoById]);

    const handleSourceClick = (source: SourceItem) => {
        setActiveSource(prev => (prev === source.id ? 'all' : source.id));
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
                    <div>
                        <h1 className="ask-h1">Agent Skills</h1>
                        <p className="ask-lede">
                            Skills are AI prompt modules the agent loads on demand. They sit alongside your code in <code>.github/skills/</code>, are versioned in git, and combine cleanly across repos. <b>{enabledCount} of {skills.length}</b> currently enabled.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                        <button
                            type="button"
                            className="ask-btn"
                            onClick={onInstalled}
                            title="Refresh skills"
                            data-testid="skills-refresh-btn"
                        >
                            <I.refresh className="ask-icon" /> Refresh
                        </button>
                        <button
                            type="button"
                            className="ask-btn ask-primary"
                            onClick={() => setShowInstallDialog(true)}
                            data-testid="skills-install-btn"
                        >
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
                        onChange={e => setSearchQuery(e.target.value)}
                        data-testid="skills-search-input"
                    />
                    <span className="ask-kbd">⌘K</span>
                </label>
                <div className="ask-chips" role="tablist">
                    {([
                        { id: 'all' as const, label: 'All', n: skills.length },
                        { id: 'on' as const, label: 'Enabled', n: enabledCount },
                        { id: 'off' as const, label: 'Disabled', n: skills.length - enabledCount },
                    ]).map(t => (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={filterStatus === t.id}
                            className={`ask-chip ${filterStatus === t.id ? 'active' : ''}`}
                            onClick={() => setFilterStatus(t.id)}
                            data-testid={`skills-filter-${t.id}`}
                        >
                            {t.label} <span className="ask-ct">{t.n}</span>
                        </button>
                    ))}
                </div>
                <div className="ask-spacer" />
                {otherRepos.length > 0 && (
                    <div className="ask-popover-anchor">
                        <button
                            type="button"
                            className="ask-btn ask-sm ask-ghost"
                            onClick={() => setShowRepoPicker(v => !v)}
                            data-testid="link-from-repo-btn"
                        >
                            <I.link className="ask-icon" /> Link a repo
                        </button>
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

            <div className="ask-body">
                <aside className="ask-rail">
                    <h4>Sources</h4>
                    <div className="ask-source-list">
                        {sources.map(s => (
                            <SourceRow
                                key={s.id}
                                source={s}
                                active={activeSource === s.id}
                                onClick={() => handleSourceClick(s)}
                                onRemove={
                                    s.removable && s.folderPath
                                        ? () => handleRemoveExtra(s.folderPath!)
                                        : undefined
                                }
                            />
                        ))}
                    </div>

                    {showAddFolder ? (
                        <div className="ask-source-input-row" data-testid="extra-folder-input-row">
                            <input
                                type="text"
                                placeholder="/path/to/folder"
                                value={newFolderInput}
                                onChange={e => setNewFolderInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && newFolderInput.trim()) {
                                        onExtraSkillFoldersChange?.([...extraSkillFolders, newFolderInput.trim()]);
                                        setNewFolderInput('');
                                        setShowAddFolder(false);
                                    } else if (e.key === 'Escape') {
                                        setNewFolderInput('');
                                        setShowAddFolder(false);
                                    }
                                }}
                                autoFocus
                                data-testid="extra-folder-input"
                            />
                            <button
                                type="button"
                                className="ask-btn ask-sm"
                                disabled={!newFolderInput.trim()}
                                onClick={() => {
                                    if (newFolderInput.trim()) {
                                        onExtraSkillFoldersChange?.([...extraSkillFolders, newFolderInput.trim()]);
                                        setNewFolderInput('');
                                        setShowAddFolder(false);
                                    }
                                }}
                                data-testid="extra-folder-add-btn"
                            >
                                Add
                            </button>
                            <button
                                type="button"
                                className="ask-btn ask-sm ask-ghost"
                                onClick={() => {
                                    setNewFolderInput('');
                                    setShowAddFolder(false);
                                }}
                                aria-label="Cancel"
                            >
                                <I.x className="ask-icon" />
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="ask-source-add"
                            onClick={() => setShowAddFolder(true)}
                            data-testid="source-add-folder-btn"
                        >
                            <I.plus className="ask-icon" /> Add folder or link repo
                        </button>
                    )}

                    <div className="ask-rail-help">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <I.zap className="ask-icon" />
                            <b>How resolution works</b>
                        </div>
                        When two skills share a name, the first one wins by source order:
                        <div className="ask-mono" style={{ marginTop: 6, color: 'var(--ask-text-2)' }}>
                            repo → global → linked → extra
                        </div>
                        <a
                            href="https://agentskills.io"
                            target="_blank"
                            rel="noreferrer"
                            style={{ display: 'inline-block', marginTop: 8 }}
                        >
                            Read the spec →
                        </a>
                    </div>
                </aside>

                <section className="ask-list">
                    {skillsLoading ? (
                        <div className="ask-loading">Loading skills…</div>
                    ) : skills.length === 0 ? (
                        <div className="ask-empty-source" data-testid="skills-empty-state">
                            <div style={{ fontSize: 14, color: 'var(--ask-text-2)', marginBottom: 4 }}>
                                No skills installed
                            </div>
                            <div style={{ fontSize: 12.5 }}>
                                Skills are AI prompt modules stored in <code>.github/skills/</code>.
                                They extend the agent&apos;s capabilities for specific tasks.
                            </div>
                            <div style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center' }}>
                                <button
                                    type="button"
                                    className="ask-btn ask-sm"
                                    onClick={() => setShowInstallDialog(true)}
                                >
                                    <I.plus className="ask-icon" /> Install skills
                                </button>
                                {otherRepos.length > 0 && (
                                    <button
                                        type="button"
                                        className="ask-btn ask-sm ask-ghost"
                                        onClick={() => setShowRepoPicker(true)}
                                        data-testid="empty-state-link-repo-btn"
                                    >
                                        <I.link className="ask-icon" /> Link a repo
                                    </button>
                                )}
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="ask-list-meta">
                                <span>
                                    {filteredSkills.length} skill{filteredSkills.length === 1 ? '' : 's'} shown
                                </span>
                                {(searchQuery || activeSource !== 'all' || filterStatus !== 'all') && (
                                    <button
                                        type="button"
                                        className="ask-btn ask-sm ask-ghost"
                                        onClick={clearFilters}
                                        data-testid="skills-clear-filters"
                                    >
                                        Clear filters
                                    </button>
                                )}
                                <span className="ask-order">Sort: A→Z</span>
                            </div>

                            {filteredSkills.length === 0 ? (
                                <div className="ask-empty-source">
                                    <div style={{ fontSize: 14, color: 'var(--ask-text-2)', marginBottom: 4 }}>
                                        No skills match these filters
                                    </div>
                                    <div style={{ fontSize: 12.5 }}>
                                        Try clearing the search or filters.
                                    </div>
                                </div>
                            ) : (
                                <div className="ask-skill-cards" data-testid="skills-list">
                                {[...filteredSkills]
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map(skill => {
                                        const kind = getSkillKind(skill);
                                        const sourceLabelText = (() => {
                                            if (kind === 'global') return '~/.coc/skills/';
                                            if (kind === 'linked') {
                                                const ws = skill.sourceRepoId ? repoById.get(skill.sourceRepoId) : null;
                                                return ws?.name ?? (skill.folderPath ?? 'linked');
                                            }
                                            if (kind === 'extra') return skill.folderPath ?? 'extra';
                                            return '.github/skills/';
                                        })();
                                        const sourcePillLabel = (() => {
                                            if (kind === 'global') return 'Global';
                                            if (kind === 'linked') {
                                                const ws = skill.sourceRepoId ? repoById.get(skill.sourceRepoId) : null;
                                                return ws?.name ?? 'Linked';
                                            }
                                            if (kind === 'extra') return 'Extra';
                                            return 'Repo';
                                        })();
                                        const isOpen = expandedSkill === skill.name;
                                        return (
                                            <SkillCard
                                                key={skill.name}
                                                skill={skill}
                                                detail={isOpen ? skillDetail : null}
                                                detailLoading={isOpen ? detailLoading : false}
                                                isOpen={isOpen}
                                                isEnabled={isSkillEnabled(skill.name)}
                                                deleteConfirming={deleteConfirm === skill.name}
                                                sourceLabel={sourceLabelText}
                                                sourceKind={kind}
                                                sourcePillLabel={sourcePillLabel}
                                                hideDelete={kind === 'linked' || kind === 'global'}
                                                toggleDisabled={skillToggleSaving || skillsLoading}
                                                onToggleOpen={() => onExpandSkill(skill.name)}
                                                onToggleEnabled={(next) => onSkillToggle(skill.name, next)}
                                                onSetDeleteConfirm={(c) => onSetDeleteConfirm(c ? skill.name : null)}
                                                onDelete={() => onDeleteSkill(skill.name)}
                                            />
                                        );
                                    })}
                                </div>
                            )}

                            <ResolutionOrder items={resolutionItems} />

                            <div className="ask-footer-note">
                                Changes are saved automatically · PATCH /api/workspaces/{workspaceId}/skills-config
                            </div>
                        </>
                    )}
                </section>
            </div>

            {showInstallDialog && (
                <InstallSkillsDialog
                    workspaceId={workspaceId}
                    onClose={() => setShowInstallDialog(false)}
                    onInstalled={() => {
                        setShowInstallDialog(false);
                        onInstalled();
                    }}
                />
            )}
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

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

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
            (r.workspace.remoteUrl || '').toLowerCase().includes(filterText.toLowerCase()),
        )
        : repos;

    return (
        <div
            ref={popoverRef}
            className="ask-popover"
            data-testid="link-from-repo-popover"
        >
            <div className="ask-popover-header">Link skills from another repo</div>
            {showFilter && (
                <div className="ask-popover-filter">
                    <input
                        autoFocus
                        type="text"
                        placeholder="Filter repos…"
                        value={filterText}
                        onChange={e => setFilterText(e.target.value)}
                        data-testid="repo-picker-filter"
                    />
                </div>
            )}
            <div className="ask-popover-list">
                {filtered.length === 0 ? (
                    <div style={{ padding: '12px 12px', fontSize: 12, color: 'var(--ask-text-3)', textAlign: 'center' }}>
                        No repos found
                    </div>
                ) : filtered.map(r => {
                    const ws = r.workspace;
                    const isLinked = linkedRepoIds.includes(ws.id);
                    const info = skillsInfo[ws.id];
                    const remoteDisplay = ws.remoteUrl || ws.rootPath || '';
                    const truncatedRemote = remoteDisplay.length > 45
                        ? '…' + remoteDisplay.slice(-42)
                        : remoteDisplay;
                    return (
                        <button
                            key={ws.id}
                            type="button"
                            className="ask-popover-item"
                            style={isLinked ? { opacity: 0.75 } : undefined}
                            onClick={() => isLinked ? onUnlink(ws.id) : onLink(ws)}
                            data-testid={`repo-picker-item-${ws.id}`}
                        >
                            <span
                                className="ask-repo-dot"
                                style={{ background: isLinked ? 'var(--ask-accent)' : (ws.color || 'var(--ask-text-3)') }}
                            />
                            <div className="ask-repo-meta">
                                <span className="ask-repo-name">
                                    {ws.name}
                                    {isLinked && (
                                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ask-text-3)' }}>(linked)</span>
                                    )}
                                </span>
                                {truncatedRemote && (
                                    <span className="ask-repo-url">{truncatedRemote}</span>
                                )}
                            </div>
                            <span className="ask-repo-count">
                                {info?.loading ? '…' : `${info?.skillCount ?? 0} skills`}
                            </span>
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
            .then(s => {
                setBundledSkills(s as BundledSkill[]);
                setSelectedBundled(new Set(s.filter(x => !x.alreadyExists).map(x => x.name)));
            })
            .catch(() => { /* ignore */ })
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
            className="agent-skills-redesign-overlay"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            data-testid="install-skills-dialog"
        >
            <div className="agent-skills-redesign-modal agent-skills-redesign">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--ask-border)' }}>
                    <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Install Skills</h3>
                    <button
                        type="button"
                        className="ask-icon-btn"
                        onClick={onClose}
                        aria-label="Close"
                        data-testid="install-dialog-close"
                    >
                        <I.x className="ask-icon" />
                    </button>
                </div>

                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ask-border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--ask-text-3)', marginBottom: 8 }}>Source</div>
                    <div style={{ display: 'flex', gap: 16 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                            <input type="radio" value="bundled" checked={source === 'bundled'} onChange={() => setSource('bundled')} />
                            Built-in skills
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                            <input type="radio" value="github" checked={source === 'github'} onChange={() => setSource('github')} />
                            GitHub URL
                        </label>
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                    {source === 'bundled' ? (
                        loadingBundled ? (
                            <div className="ask-loading">Loading bundled skills…</div>
                        ) : bundledSkills.length === 0 ? (
                            <div className="ask-loading">No bundled skills available.</div>
                        ) : (
                            <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
                                {bundledSkills.map(s => (
                                    <li key={s.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                        <input
                                            type="checkbox"
                                            id={`bundled-${s.name}`}
                                            checked={selectedBundled.has(s.name)}
                                            onChange={e => {
                                                setSelectedBundled(prev => {
                                                    const next = new Set(prev);
                                                    if (e.target.checked) next.add(s.name); else next.delete(s.name);
                                                    return next;
                                                });
                                            }}
                                            style={{ marginTop: 3 }}
                                        />
                                        <label htmlFor={`bundled-${s.name}`} style={{ flex: 1, cursor: 'pointer' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ask-text)' }}>
                                                {s.name}
                                                {s.alreadyExists && (
                                                    <span style={{ fontSize: 10, color: 'var(--ask-text-3)', background: 'var(--ask-surface-2)', padding: '1px 7px', borderRadius: 999 }}>
                                                        installed
                                                    </span>
                                                )}
                                            </div>
                                            {s.description && (
                                                <div style={{ fontSize: 12, color: 'var(--ask-text-2)' }}>{s.description}</div>
                                            )}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div>
                                <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--ask-text-3)', display: 'block', marginBottom: 4 }}>GitHub URL</label>
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <input
                                        type="text"
                                        value={githubUrl}
                                        onChange={e => setGithubUrl(e.target.value)}
                                        placeholder="https://github.com/owner/repo/tree/main/skills"
                                        disabled={scanning}
                                        onKeyDown={e => { if (e.key === 'Enter' && githubUrl) handleScan(); }}
                                        data-testid="github-url-input"
                                        style={{
                                            flex: 1,
                                            padding: '6px 8px',
                                            borderRadius: 'var(--ask-radius-sm)',
                                            border: '1px solid var(--ask-border)',
                                            background: 'var(--ask-surface)',
                                            color: 'var(--ask-text)',
                                            fontSize: 12,
                                            outline: 'none',
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="ask-btn ask-sm"
                                        onClick={handleScan}
                                        disabled={!githubUrl || scanning}
                                        data-testid="scan-btn"
                                    >
                                        {scanning ? '…' : 'Scan'}
                                    </button>
                                </div>
                                {scanError && (
                                    <div style={{ fontSize: 12, color: 'var(--ask-danger)', marginTop: 4 }} data-testid="scan-error">{scanError}</div>
                                )}
                            </div>
                            {scanResult && scanResult.skills?.length > 0 && (
                                <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
                                    {scanResult.skills.map((s: any) => (
                                        <li key={s.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                id={`github-${s.name}`}
                                                checked={selectedGithub.has(s.name)}
                                                onChange={e => {
                                                    setSelectedGithub(prev => {
                                                        const next = new Set(prev);
                                                        if (e.target.checked) next.add(s.name); else next.delete(s.name);
                                                        return next;
                                                    });
                                                }}
                                                style={{ marginTop: 3 }}
                                            />
                                            <label htmlFor={`github-${s.name}`} style={{ flex: 1, cursor: 'pointer' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ask-text)' }}>
                                                    {s.name}
                                                    {s.alreadyExists && (
                                                        <span style={{ fontSize: 10, color: 'var(--ask-warn)', background: 'color-mix(in oklab, var(--ask-warn) 15%, transparent)', padding: '1px 7px', borderRadius: 999 }}>
                                                            will replace
                                                        </span>
                                                    )}
                                                </div>
                                                {s.description && (
                                                    <div style={{ fontSize: 12, color: 'var(--ask-text-2)' }}>{s.description}</div>
                                                )}
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--ask-border)' }}>
                    <button
                        type="button"
                        className="ask-btn ask-sm"
                        onClick={onClose}
                        data-testid="install-dialog-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="ask-btn ask-sm ask-primary"
                        onClick={handleInstall}
                        disabled={!canInstall || installing}
                        data-testid="install-dialog-submit"
                    >
                        {installing ? 'Installing…' : `Install (${source === 'bundled' ? selectedBundled.size : selectedGithub.size})`}
                    </button>
                </div>
            </div>
        </div>
    );
}
