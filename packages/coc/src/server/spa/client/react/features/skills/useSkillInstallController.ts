import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveredSkill, InstallSkillsRequest, ScanSkillsResponse } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import type { SkillsNotification, WorkspaceSkillsClientResolver } from './useWorkspaceSkillsController';

export type InstallSource = 'bundled' | 'github';

export interface SkillInstallControllerOptions {
    workspaceId: string;
    resolveClient: WorkspaceSkillsClientResolver;
    onInstalled: () => void;
    notify?: SkillsNotification;
}

export function useSkillInstallController({
    workspaceId,
    resolveClient,
    onInstalled,
    notify,
}: SkillInstallControllerOptions) {
    const [source, setSource] = useState<InstallSource>('bundled');
    const [bundledSkills, setBundledSkills] = useState<DiscoveredSkill[]>([]);
    const [selectedBundled, setSelectedBundled] = useState<Set<string>>(new Set());
    const [loadingBundled, setLoadingBundled] = useState(false);
    const [bundledError, setBundledError] = useState('');
    const [githubUrl, setGithubUrl] = useState('');
    const [scanResult, setScanResult] = useState<ScanSkillsResponse | null>(null);
    const [scanning, setScanning] = useState(false);
    const [scanError, setScanError] = useState('');
    const [selectedGithub, setSelectedGithub] = useState<Set<string>>(new Set());
    const [installing, setInstalling] = useState(false);
    const scopeGeneration = useRef(0);
    const bundledGeneration = useRef(0);
    const scanGeneration = useRef(0);
    const installGeneration = useRef(0);
    const resolveClientRef = useRef(resolveClient);
    const notifyRef = useRef(notify);
    const onInstalledRef = useRef(onInstalled);

    notifyRef.current = notify;
    resolveClientRef.current = resolveClient;
    onInstalledRef.current = onInstalled;

    useEffect(() => {
        scopeGeneration.current += 1;
        bundledGeneration.current += 1;
        scanGeneration.current += 1;
        installGeneration.current += 1;
        setSource('bundled');
        setBundledSkills([]);
        setSelectedBundled(new Set());
        setBundledError('');
        setGithubUrl('');
        setScanResult(null);
        setScanError('');
        setSelectedGithub(new Set());
        setInstalling(false);
        return () => {
            scopeGeneration.current += 1;
            bundledGeneration.current += 1;
            scanGeneration.current += 1;
            installGeneration.current += 1;
        };
    }, [workspaceId]);

    useEffect(() => {
        if (source !== 'bundled') {return;}
        const requestGeneration = ++bundledGeneration.current;
        const requestScope = scopeGeneration.current;
        setLoadingBundled(true);
        setBundledError('');
        resolveClientRef.current(workspaceId).skills.listBundledWorkspace(workspaceId)
            .then(skills => {
                if (requestGeneration !== bundledGeneration.current || requestScope !== scopeGeneration.current) {return;}
                setBundledSkills(skills);
                setSelectedBundled(new Set(skills.filter(skill => !skill.alreadyExists).map(skill => skill.name)));
            })
            .catch(error => {
                if (requestGeneration !== bundledGeneration.current || requestScope !== scopeGeneration.current) {return;}
                setBundledError(getSpaCocClientErrorMessage(error, 'Failed to load bundled skills'));
            })
            .finally(() => {
                if (requestGeneration === bundledGeneration.current && requestScope === scopeGeneration.current) {
                    setLoadingBundled(false);
                }
            });
    }, [source, workspaceId]);

    const selectSource = useCallback((nextSource: InstallSource) => {
        bundledGeneration.current += 1;
        scanGeneration.current += 1;
        setSource(nextSource);
        setScanResult(null);
        setScanError('');
        setSelectedGithub(new Set());
        setScanning(false);
    }, []);

    const toggleBundled = useCallback((name: string, selected: boolean) => {
        setSelectedBundled(current => {
            const next = new Set(current);
            if (selected) {next.add(name);}
            else {next.delete(name);}
            return next;
        });
    }, []);

    const toggleGithub = useCallback((name: string, selected: boolean) => {
        setSelectedGithub(current => {
            const next = new Set(current);
            if (selected) {next.add(name);}
            else {next.delete(name);}
            return next;
        });
    }, []);

    const scan = useCallback(async () => {
        const requestGeneration = ++scanGeneration.current;
        const requestScope = scopeGeneration.current;
        setScanError('');
        setScanResult(null);
        setSelectedGithub(new Set());
        setScanning(true);
        try {
            const result = await resolveClientRef.current(workspaceId).skills.scanWorkspace(workspaceId, { url: githubUrl });
            if (requestGeneration !== scanGeneration.current || requestScope !== scopeGeneration.current) {return;}
            if (!result.success) {
                setScanError(result.error || 'Scan failed');
                return;
            }
            setScanResult(result);
            setSelectedGithub(new Set(result.skills.map(skill => skill.name)));
        } catch (error) {
            if (requestGeneration === scanGeneration.current && requestScope === scopeGeneration.current) {
                setScanError(getSpaCocClientErrorMessage(error, 'Scan failed'));
            }
        } finally {
            if (requestGeneration === scanGeneration.current && requestScope === scopeGeneration.current) {
                setScanning(false);
            }
        }
    }, [githubUrl, workspaceId]);

    const install = useCallback(async () => {
        const requestGeneration = ++installGeneration.current;
        const requestScope = scopeGeneration.current;
        const request: InstallSkillsRequest = source === 'bundled'
            ? { source: 'bundled', skills: [...selectedBundled] }
            : {
                source: 'github',
                url: githubUrl,
                skillsToInstall: scanResult?.skills.filter(skill => selectedGithub.has(skill.name)) ?? [],
            };
        setInstalling(true);
        try {
            const result = await resolveClientRef.current(workspaceId).skills.installWorkspace(workspaceId, request);
            if (requestGeneration !== installGeneration.current || requestScope !== scopeGeneration.current) {return;}
            if (result.failed > 0) {
                notifyRef.current?.(`${result.installed} skill(s) installed, ${result.failed} failed`, 'error');
            } else {
                notifyRef.current?.(`${result.installed} skill(s) installed successfully`, 'success');
            }
            onInstalledRef.current();
        } catch (error) {
            if (requestGeneration === installGeneration.current && requestScope === scopeGeneration.current) {
                notifyRef.current?.(getSpaCocClientErrorMessage(error, 'Installation failed'), 'error');
            }
        } finally {
            if (requestGeneration === installGeneration.current && requestScope === scopeGeneration.current) {
                setInstalling(false);
            }
        }
    }, [githubUrl, scanResult, selectedBundled, selectedGithub, source, workspaceId]);

    return {
        source,
        selectSource,
        bundledSkills,
        selectedBundled,
        loadingBundled,
        bundledError,
        toggleBundled,
        githubUrl,
        setGithubUrl,
        scanResult,
        scanning,
        scanError,
        selectedGithub,
        toggleGithub,
        scan,
        installing,
        install,
        canInstall: source === 'bundled' ? selectedBundled.size > 0 : selectedGithub.size > 0,
        selectedCount: source === 'bundled' ? selectedBundled.size : selectedGithub.size,
    };
}
