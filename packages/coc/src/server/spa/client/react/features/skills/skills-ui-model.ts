import type { SkillInfo } from '@plusplusoneplusplus/coc-client';

export type Skill = SkillInfo;
export type SkillDetail = SkillInfo;
export type SourceKind = 'all' | 'repo' | 'global' | 'linked' | 'extra';
export type SkillStatusFilter = 'all' | 'on' | 'off';

export interface SkillRepoSummary {
    id: string;
    name?: string;
    rootPath?: string;
    color?: string;
}

export interface SkillFolderGroup {
    key: string;
    label: string;
    folderPath: string;
    source: 'global' | 'repo' | 'linked-repo' | 'extra-folder' | 'global-extra-folder';
    skills: Skill[];
    repoId?: string;
    isRemovable: boolean;
}

export interface SkillsSourceItem {
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

export interface SkillsResolutionItem {
    id: string;
    kind: SourceKind;
    label: string;
    path: string;
    reorderable: boolean;
    folderPath?: string;
    upDisabled?: boolean;
    downDisabled?: boolean;
}

export interface SkillSourcePresentation {
    kind: SourceKind;
    sourceLabel: string;
    sourcePillLabel: string;
    hideDelete: boolean;
}

function finalPathSegment(folderPath: string): string {
    return folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
}

export function normalizeSkillFolderPath(folderPath: string): string {
    return folderPath.replace(/\\/g, '/').replace(/\/$/, '');
}

export function isResolvedSkillFolderForConfiguredSource(resolvedFolder: string, configuredFolder: string): boolean {
    const resolved = normalizeSkillFolderPath(resolvedFolder);
    const configured = normalizeSkillFolderPath(configuredFolder);
    return resolved === configured
        || resolved === `${configured}/.github/skills`
        || resolved === `${configured}/skills`;
}

export function groupSkillsByFolder(
    skills: Skill[],
    repoById: ReadonlyMap<string, SkillRepoSummary>,
): SkillFolderGroup[] {
    const groups: SkillFolderGroup[] = [];
    const globalSkills = skills.filter(skill => skill.source === 'global');
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
        skill => skill.source === 'repo' || (!skill.source && !skill.sourceRepoId),
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

    const globalExtraSkills = skills.filter(skill => skill.source === 'global-extra-folder');
    const globalExtraByFolder = new Map<string, Skill[]>();
    for (const skill of globalExtraSkills) {
        const folderPath = skill.folderPath ?? '';
        globalExtraByFolder.set(folderPath, [...(globalExtraByFolder.get(folderPath) ?? []), skill]);
    }
    for (const [folderPath, folderSkills] of globalExtraByFolder) {
        groups.push({
            key: `global-extra:${folderPath}`,
            label: `🌐 ${folderPath}`,
            folderPath,
            source: 'global-extra-folder',
            skills: folderSkills,
            isRemovable: false,
        });
    }

    const extraSkills = skills.filter(
        skill => skill.source === 'linked-repo' || skill.source === 'extra-folder',
    );
    const extrasByFolder = new Map<string, Skill[]>();
    for (const skill of extraSkills) {
        const folderPath = skill.folderPath ?? skill.sourceRepoId ?? '';
        extrasByFolder.set(folderPath, [...(extrasByFolder.get(folderPath) ?? []), skill]);
    }
    for (const [folderPath, folderSkills] of extrasByFolder) {
        const first = folderSkills[0];
        const repoId = first.sourceRepoId;
        const repo = repoId ? repoById.get(repoId) : undefined;
        groups.push({
            key: folderPath,
            label: repo?.name ? `📂 ${repo.name}` : `📂 ${folderPath}`,
            folderPath,
            source: first.source as 'linked-repo' | 'extra-folder',
            skills: folderSkills,
            repoId,
            isRemovable: true,
        });
    }

    return groups;
}

export function buildSkillsSources(
    skills: Skill[],
    skillGroups: SkillFolderGroup[],
    repoById: ReadonlyMap<string, SkillRepoSummary>,
): SkillsSourceItem[] {
    const sources: SkillsSourceItem[] = [{
        id: 'all',
        kind: 'all',
        name: 'All skills',
        path: '',
        count: skills.length,
        removable: false,
    }];

    for (const group of skillGroups) {
        if (group.source === 'repo') {
            sources.push({
                id: 'group:repo',
                kind: 'repo',
                name: 'This repository',
                path: '.github/skills/',
                count: group.skills.length,
                removable: false,
                folderPath: group.folderPath,
            });
            continue;
        }
        if (group.source === 'global') {
            sources.push({
                id: 'group:global',
                kind: 'global',
                name: 'Global',
                path: '~/.coc/skills/',
                count: group.skills.length,
                removable: false,
                folderPath: group.folderPath,
            });
            continue;
        }
        if (group.source === 'linked-repo') {
            const repo = group.repoId ? repoById.get(group.repoId) : undefined;
            sources.push({
                id: `group:${group.key}`,
                kind: 'linked',
                name: repo?.name ?? group.folderPath,
                path: group.folderPath,
                count: group.skills.length,
                removable: true,
                repoColor: repo?.color,
                repoId: group.repoId,
                folderPath: group.folderPath,
            });
            continue;
        }
        sources.push({
            id: `group:${group.key}`,
            kind: 'extra',
            name: finalPathSegment(group.folderPath),
            path: group.folderPath,
            count: group.skills.length,
            removable: group.source === 'extra-folder',
            folderPath: group.folderPath,
        });
    }

    return sources;
}

export function getSkillSourceKind(skill: Skill): SourceKind {
    if (skill.source === 'global') {return 'global';}
    if (skill.source === 'linked-repo') {return 'linked';}
    if (skill.source === 'extra-folder' || skill.source === 'global-extra-folder') {return 'extra';}
    return 'repo';
}

export function filterWorkspaceSkills({
    skills,
    sources,
    activeSource,
    status,
    searchQuery,
    disabledSkills,
}: {
    skills: Skill[];
    sources: SkillsSourceItem[];
    activeSource: string;
    status: SkillStatusFilter;
    searchQuery: string;
    disabledSkills: string[];
}): Skill[] {
    let filtered = skills;
    if (activeSource !== 'all') {
        const source = sources.find(item => item.id === activeSource);
        if (source?.kind === 'repo') {
            filtered = filtered.filter(skill => skill.source === 'repo' || (!skill.source && !skill.sourceRepoId));
        } else if (source?.kind === 'global') {
            filtered = filtered.filter(skill => skill.source === 'global');
        } else if (source?.kind === 'linked' || source?.kind === 'extra') {
            filtered = filtered.filter(skill => (skill.folderPath ?? '') === source.folderPath);
        }
    }

    const disabled = new Set(disabledSkills);
    if (status === 'on') {filtered = filtered.filter(skill => !disabled.has(skill.name));}
    if (status === 'off') {filtered = filtered.filter(skill => disabled.has(skill.name));}

    if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(skill =>
            skill.name.toLowerCase().includes(query)
            || (skill.description?.toLowerCase().includes(query) ?? false)
            || (skill.variables?.some(variable => variable.toLowerCase().includes(query)) ?? false),
        );
    }

    return filtered;
}

export function findLinkedRepoForFolder(
    folderPath: string,
    linkedRepoIds: string[],
    repoById: ReadonlyMap<string, SkillRepoSummary>,
): { id: string; repo: SkillRepoSummary } | null {
    const normalizedFolder = normalizeSkillFolderPath(folderPath);
    for (const id of linkedRepoIds) {
        const repo = repoById.get(id);
        if (!repo?.rootPath) {continue;}
        const expectedPath = normalizeSkillFolderPath(`${repo.rootPath}/.github/skills`);
        if (normalizedFolder === expectedPath) {return { id, repo };}
    }
    return null;
}

export function buildSkillsResolutionItems(
    skillGroups: SkillFolderGroup[],
    extraSkillFolders: string[],
    linkedRepoIds: string[],
    repoById: ReadonlyMap<string, SkillRepoSummary>,
): SkillsResolutionItem[] {
    const items: SkillsResolutionItem[] = [];
    for (const group of skillGroups) {
        if (group.source === 'repo') {
            items.push({
                id: 'repo',
                kind: 'repo',
                label: 'This repository',
                path: '.github/skills/',
                reorderable: false,
            });
        } else if (group.source === 'global') {
            items.push({
                id: 'global',
                kind: 'global',
                label: 'Global',
                path: '~/.coc/skills/',
                reorderable: false,
            });
        }
    }

    extraSkillFolders.forEach((folderPath, index) => {
        const linked = findLinkedRepoForFolder(folderPath, linkedRepoIds, repoById);
        items.push({
            id: `extra:${index}`,
            kind: linked ? 'linked' : 'extra',
            label: linked?.repo.name ?? finalPathSegment(folderPath),
            path: folderPath,
            reorderable: true,
            folderPath,
            upDisabled: index === 0,
            downDisabled: index === extraSkillFolders.length - 1,
        });
    });

    return items;
}

export function getSkillSourcePresentation(
    skill: Skill,
    repoById: ReadonlyMap<string, SkillRepoSummary>,
): SkillSourcePresentation {
    const kind = getSkillSourceKind(skill);
    if (kind === 'global') {
        return { kind, sourceLabel: '~/.coc/skills/', sourcePillLabel: 'Global', hideDelete: true };
    }
    if (kind === 'linked') {
        const repo = skill.sourceRepoId ? repoById.get(skill.sourceRepoId) : undefined;
        return {
            kind,
            sourceLabel: repo?.name ?? skill.folderPath ?? 'linked',
            sourcePillLabel: repo?.name ?? 'Linked',
            hideDelete: true,
        };
    }
    if (kind === 'extra') {
        return {
            kind,
            sourceLabel: skill.folderPath ?? 'extra',
            sourcePillLabel: 'Extra',
            hideDelete: true,
        };
    }
    return { kind, sourceLabel: '.github/skills/', sourcePillLabel: 'Repo', hideDelete: false };
}
