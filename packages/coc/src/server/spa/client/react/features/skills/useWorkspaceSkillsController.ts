import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CocClient, SkillFileResponse, SkillInfo, WorkspaceSkillsPathResponse } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import type { RepoData } from '../../repos/repoGrouping';
import {
    findLinkedRepoForFolder,
    isResolvedSkillFolderForConfiguredSource,
    normalizeSkillFolderPath,
    type SkillRepoSummary,
} from './skills-ui-model';

export type WorkspaceSkillsClient = Pick<CocClient, 'skills' | 'preferences'>;
export type WorkspaceSkillsClientResolver = (workspaceId: string) => WorkspaceSkillsClient;
export type SkillsNotification = (message: string, type: 'success' | 'error') => void;

export interface WorkspaceSkillsControllerOptions {
    workspaceId: string;
    resolveClient: WorkspaceSkillsClientResolver;
    repos?: RepoData[];
    loadLinkedRepoPreferences?: boolean;
    notify?: SkillsNotification;
}

export interface WorkspaceSkillsController {
    skills: SkillInfo[];
    skillsLoading: boolean;
    skillsError: string | null;
    disabledSkills: string[];
    extraSkillFolders: string[];
    linkedRepoIds: string[];
    skillToggleSaving: boolean;
    expandedSkill: string | null;
    skillDetail: SkillInfo | null;
    detailLoading: boolean;
    detailError: string | null;
    deleteConfirm: string | null;
    setDeleteConfirm: (name: string | null) => void;
    refresh: () => Promise<void>;
    expandSkill: (name: string) => Promise<void>;
    deleteSkill: (name: string) => Promise<void>;
    toggleSkill: (name: string, enabled: boolean) => Promise<void>;
    addExtraSkillFolder: (folderPath: string) => Promise<void>;
    removeExtraSkillFolder: (folderPath: string) => Promise<void>;
    moveExtraSkillFolder: (folderPath: string, delta: -1 | 1) => Promise<void>;
    linkRepo: (repo: SkillRepoSummary) => Promise<boolean>;
    unlinkRepo: (repoId: string) => Promise<void>;
    readSkillFile: (skillName: string, relativePath: string) => Promise<SkillFileResponse>;
    probeRepoSkills: (repoId: string) => Promise<WorkspaceSkillsPathResponse>;
}

const EMPTY_REPOS: RepoData[] = [];

function toRepoMap(repos: RepoData[]): Map<string, SkillRepoSummary> {
    return new Map(repos.map(repo => [repo.workspace.id, repo.workspace as SkillRepoSummary]));
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
}

export function useWorkspaceSkillsController({
    workspaceId,
    resolveClient,
    repos = EMPTY_REPOS,
    loadLinkedRepoPreferences = false,
    notify,
}: WorkspaceSkillsControllerOptions): WorkspaceSkillsController {
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const [skillsError, setSkillsError] = useState<string | null>(null);
    const [disabledSkills, setDisabledSkills] = useState<string[]>([]);
    const [extraSkillFolders, setExtraSkillFolders] = useState<string[]>([]);
    const [linkedRepoIds, setLinkedRepoIds] = useState<string[]>([]);
    const [skillToggleSaving, setSkillToggleSaving] = useState(false);
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
    const [skillDetail, setSkillDetail] = useState<SkillInfo | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    const scopeGeneration = useRef(0);
    const loadGeneration = useRef(0);
    const detailGeneration = useRef(0);
    const toggleGeneration = useRef(0);
    const configGeneration = useRef(0);
    const linkedGeneration = useRef(0);
    const resolveClientRef = useRef(resolveClient);
    const notifyRef = useRef(notify);
    const disabledSkillsRef = useRef(disabledSkills);
    const extraSkillFoldersRef = useRef(extraSkillFolders);
    const linkedRepoIdsRef = useRef(linkedRepoIds);
    const expandedSkillRef = useRef(expandedSkill);
    const skillsRef = useRef(skills);

    notifyRef.current = notify;
    resolveClientRef.current = resolveClient;
    disabledSkillsRef.current = disabledSkills;
    extraSkillFoldersRef.current = extraSkillFolders;
    linkedRepoIdsRef.current = linkedRepoIds;
    expandedSkillRef.current = expandedSkill;
    skillsRef.current = skills;

    const repoById = useMemo(() => toRepoMap(repos), [repos]);

    const refresh = useCallback(async () => {
        const requestGeneration = ++loadGeneration.current;
        const requestScope = scopeGeneration.current;
        const client = resolveClientRef.current(workspaceId);
        setSkillsLoading(true);
        setSkillsError(null);

        const requests: [Promise<SkillInfo[]>, ReturnType<typeof client.skills.getWorkspaceConfig>, Promise<unknown>?] = [
            client.skills.listWorkspace(workspaceId),
            client.skills.getWorkspaceConfig(workspaceId),
        ];
        if (loadLinkedRepoPreferences) {requests.push(client.preferences.getRepo(workspaceId));}
        const [skillsResult, configResult, preferencesResult] = await Promise.allSettled(requests);

        if (requestGeneration !== loadGeneration.current || requestScope !== scopeGeneration.current) {return;}

        const errors: string[] = [];
        if (skillsResult.status === 'fulfilled') {
            setSkills(skillsResult.value);
        } else {
            errors.push(getSpaCocClientErrorMessage(skillsResult.reason, 'Failed to load skills'));
        }
        if (configResult.status === 'fulfilled') {
            setDisabledSkills(configResult.value.disabledSkills ?? []);
            setExtraSkillFolders(configResult.value.extraSkillFolders ?? []);
        } else {
            errors.push(getSpaCocClientErrorMessage(configResult.reason, 'Failed to load skill config'));
        }
        if (loadLinkedRepoPreferences && preferencesResult) {
            if (preferencesResult.status === 'fulfilled') {
                const preferences = preferencesResult.value as { linkedRepoIds?: string[] };
                setLinkedRepoIds(preferences.linkedRepoIds ?? []);
            } else {
                errors.push(getSpaCocClientErrorMessage(preferencesResult.reason, 'Failed to load linked repos'));
            }
        }
        setSkillsError(errors.length > 0 ? uniqueStrings(errors).join(' · ') : null);
        setSkillsLoading(false);
    }, [loadLinkedRepoPreferences, workspaceId]);

    useEffect(() => {
        scopeGeneration.current += 1;
        loadGeneration.current += 1;
        detailGeneration.current += 1;
        toggleGeneration.current += 1;
        configGeneration.current += 1;
        linkedGeneration.current += 1;
        setSkills([]);
        setSkillsLoading(true);
        setSkillsError(null);
        setDisabledSkills([]);
        setExtraSkillFolders([]);
        setLinkedRepoIds([]);
        setSkillToggleSaving(false);
        setExpandedSkill(null);
        setSkillDetail(null);
        setDetailLoading(false);
        setDetailError(null);
        setDeleteConfirm(null);
        void refresh();
        return () => {
            scopeGeneration.current += 1;
            loadGeneration.current += 1;
            detailGeneration.current += 1;
        };
    }, [refresh, workspaceId]);

    const expandSkill = useCallback(async (name: string) => {
        const requestGeneration = ++detailGeneration.current;
        if (expandedSkillRef.current === name) {
            setExpandedSkill(null);
            setSkillDetail(null);
            setDetailLoading(false);
            setDetailError(null);
            return;
        }

        const requestScope = scopeGeneration.current;
        const listedSkill = skillsRef.current.find(skill => skill.name === name);
        setExpandedSkill(name);
        setSkillDetail(null);
        setDetailError(null);
        if (
            listedSkill?.source === 'linked-repo'
            || listedSkill?.source === 'extra-folder'
            || listedSkill?.source === 'global-extra-folder'
        ) {
            setSkillDetail(listedSkill);
            setDetailLoading(false);
            return;
        }

        setDetailLoading(true);
        try {
            const client = resolveClientRef.current(workspaceId);
            const response = listedSkill?.source === 'global'
                ? await client.skills.detailGlobal(name)
                : await client.skills.detailWorkspace(workspaceId, name);
            if (requestGeneration !== detailGeneration.current || requestScope !== scopeGeneration.current) {return;}
            setSkillDetail(response.skill ?? null);
        } catch (error) {
            if (requestGeneration !== detailGeneration.current || requestScope !== scopeGeneration.current) {return;}
            setDetailError(getSpaCocClientErrorMessage(error, `Failed to load ${name}`));
        } finally {
            if (requestGeneration === detailGeneration.current && requestScope === scopeGeneration.current) {
                setDetailLoading(false);
            }
        }
    }, [workspaceId]);

    const deleteSkill = useCallback(async (name: string) => {
        const requestScope = scopeGeneration.current;
        try {
            await resolveClientRef.current(workspaceId).skills.deleteWorkspace(workspaceId, name);
            if (requestScope !== scopeGeneration.current) {return;}
            notifyRef.current?.(`Deleted skill: ${name}`, 'success');
            if (expandedSkillRef.current === name) {
                detailGeneration.current += 1;
                setExpandedSkill(null);
                setSkillDetail(null);
                setDetailError(null);
            }
            await refresh();
        } catch (error) {
            if (requestScope === scopeGeneration.current) {
                notifyRef.current?.(getSpaCocClientErrorMessage(error, `Failed to delete ${name}`), 'error');
            }
        } finally {
            if (requestScope === scopeGeneration.current) {setDeleteConfirm(null);}
        }
    }, [refresh, workspaceId]);

    const toggleSkill = useCallback(async (name: string, enabled: boolean) => {
        const requestGeneration = ++toggleGeneration.current;
        const requestScope = scopeGeneration.current;
        const previous = disabledSkillsRef.current;
        const next = enabled
            ? previous.filter(disabledName => disabledName !== name)
            : uniqueStrings([...previous, name]);
        setDisabledSkills(next);
        setSkillToggleSaving(true);
        try {
            await resolveClientRef.current(workspaceId).skills.updateWorkspaceConfig(workspaceId, { disabledSkills: next });
        } catch (error) {
            if (requestGeneration === toggleGeneration.current && requestScope === scopeGeneration.current) {
                setDisabledSkills(previous);
                notifyRef.current?.(getSpaCocClientErrorMessage(error, 'Failed to save skill config'), 'error');
            }
        } finally {
            if (requestGeneration === toggleGeneration.current && requestScope === scopeGeneration.current) {
                setSkillToggleSaving(false);
            }
        }
    }, [workspaceId]);

    const updateExtraSkillFolders = useCallback(async (nextFolders: string[]) => {
        const requestGeneration = ++configGeneration.current;
        const requestScope = scopeGeneration.current;
        const previous = extraSkillFoldersRef.current;
        const next = uniqueStrings(nextFolders);
        setExtraSkillFolders(next);
        try {
            await resolveClientRef.current(workspaceId).skills.updateWorkspaceConfig(workspaceId, {
                disabledSkills: disabledSkillsRef.current,
                extraSkillFolders: next,
            });
            if (requestGeneration === configGeneration.current && requestScope === scopeGeneration.current) {
                await refresh();
            }
        } catch (error) {
            if (requestGeneration === configGeneration.current && requestScope === scopeGeneration.current) {
                setExtraSkillFolders(previous);
                notifyRef.current?.(getSpaCocClientErrorMessage(error, 'Failed to save skill config'), 'error');
            }
        }
    }, [refresh, workspaceId]);

    const addExtraSkillFolder = useCallback(async (folderPath: string) => {
        const trimmed = folderPath.trim();
        if (!trimmed) {return;}
        await updateExtraSkillFolders([...extraSkillFoldersRef.current, trimmed]);
    }, [updateExtraSkillFolders]);

    const moveExtraSkillFolder = useCallback(async (folderPath: string, delta: -1 | 1) => {
        const current = extraSkillFoldersRef.current;
        const index = current.indexOf(folderPath);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= current.length) {return;}
        const next = [...current];
        [next[index], next[target]] = [next[target], next[index]];
        await updateExtraSkillFolders(next);
    }, [updateExtraSkillFolders]);

    const unlinkRepo = useCallback(async (repoId: string) => {
        const requestGeneration = ++linkedGeneration.current;
        const requestScope = scopeGeneration.current;
        const previousFolders = extraSkillFoldersRef.current;
        const previousIds = linkedRepoIdsRef.current;
        const repo = repoById.get(repoId);
        const listedLinkedFolder = skillsRef.current.find(skill => skill.sourceRepoId === repoId)?.folderPath;
        const expectedPath = repo?.rootPath
            ? normalizeSkillFolderPath(`${repo.rootPath}/.github/skills`)
            : listedLinkedFolder ? normalizeSkillFolderPath(listedLinkedFolder) : null;
        const nextFolders = expectedPath
            ? previousFolders.filter(folder => normalizeSkillFolderPath(folder) !== expectedPath)
            : previousFolders;
        const nextIds = previousIds.filter(id => id !== repoId);
        setExtraSkillFolders(nextFolders);
        setLinkedRepoIds(nextIds);
        try {
            const client = resolveClientRef.current(workspaceId);
            await Promise.all([
                client.skills.updateWorkspaceConfig(workspaceId, {
                    disabledSkills: disabledSkillsRef.current,
                    extraSkillFolders: nextFolders,
                }),
                client.preferences.patchRepo(workspaceId, { linkedRepoIds: nextIds }),
            ]);
            if (requestGeneration === linkedGeneration.current && requestScope === scopeGeneration.current) {
                await refresh();
            }
        } catch (error) {
            if (requestGeneration === linkedGeneration.current && requestScope === scopeGeneration.current) {
                setExtraSkillFolders(previousFolders);
                setLinkedRepoIds(previousIds);
                notifyRef.current?.(getSpaCocClientErrorMessage(error, 'Failed to unlink repo skills'), 'error');
            }
        }
    }, [refresh, repoById, workspaceId]);

    const removeExtraSkillFolder = useCallback(async (folderPath: string) => {
        const linked = findLinkedRepoForFolder(folderPath, linkedRepoIdsRef.current, repoById);
        if (linked) {
            await unlinkRepo(linked.id);
            return;
        }
        await updateExtraSkillFolders(extraSkillFoldersRef.current.filter(
            configuredFolder => !isResolvedSkillFolderForConfiguredSource(folderPath, configuredFolder),
        ));
    }, [repoById, unlinkRepo, updateExtraSkillFolders]);

    const linkRepo = useCallback(async (repo: SkillRepoSummary): Promise<boolean> => {
        const requestGeneration = ++linkedGeneration.current;
        const requestScope = scopeGeneration.current;
        try {
            const client = resolveClientRef.current(workspaceId);
            const pathInfo = await client.skills.getWorkspacePath(repo.id);
            if (requestGeneration !== linkedGeneration.current || requestScope !== scopeGeneration.current) {return false;}
            if (!pathInfo.accessible) {throw new Error(`Skills folder for ${repo.name ?? repo.id} is not accessible`);}

            const previousFolders = extraSkillFoldersRef.current;
            const previousIds = linkedRepoIdsRef.current;
            const nextFolders = uniqueStrings([...previousFolders, pathInfo.path]);
            const nextIds = uniqueStrings([...previousIds, repo.id]);
            setExtraSkillFolders(nextFolders);
            setLinkedRepoIds(nextIds);
            try {
                await Promise.all([
                    client.skills.updateWorkspaceConfig(workspaceId, {
                        disabledSkills: disabledSkillsRef.current,
                        extraSkillFolders: nextFolders,
                    }),
                    client.preferences.patchRepo(workspaceId, { linkedRepoIds: nextIds }),
                ]);
                if (requestGeneration === linkedGeneration.current && requestScope === scopeGeneration.current) {
                    await refresh();
                    return true;
                }
            } catch (error) {
                if (requestGeneration === linkedGeneration.current && requestScope === scopeGeneration.current) {
                    setExtraSkillFolders(previousFolders);
                    setLinkedRepoIds(previousIds);
                    throw error;
                }
            }
        } catch (error) {
            if (requestGeneration === linkedGeneration.current && requestScope === scopeGeneration.current) {
                notifyRef.current?.(getSpaCocClientErrorMessage(error, 'Failed to link repo skills'), 'error');
            }
        }
        return false;
    }, [refresh, workspaceId]);

    const readSkillFile = useCallback((skillName: string, relativePath: string) => (
        resolveClientRef.current(workspaceId).skills.readWorkspaceSkillFile(workspaceId, skillName, relativePath)
    ), [workspaceId]);

    const probeRepoSkills = useCallback((repoId: string) => (
        resolveClientRef.current(workspaceId).skills.getWorkspacePath(repoId)
    ), [workspaceId]);

    return {
        skills,
        skillsLoading,
        skillsError,
        disabledSkills,
        extraSkillFolders,
        linkedRepoIds,
        skillToggleSaving,
        expandedSkill,
        skillDetail,
        detailLoading,
        detailError,
        deleteConfirm,
        setDeleteConfirm,
        refresh,
        expandSkill,
        deleteSkill,
        toggleSkill,
        addExtraSkillFolder,
        removeExtraSkillFolder,
        moveExtraSkillFolder,
        linkRepo,
        unlinkRepo,
        readSkillFile,
        probeRepoSkills,
    };
}
