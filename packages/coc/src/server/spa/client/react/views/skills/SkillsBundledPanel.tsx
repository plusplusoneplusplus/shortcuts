/**
 * SkillsBundledPanel — lists bundled skills available for global installation.
 * Shows "Installed" badge for skills already in the global directory.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../hooks/useApi';

interface BundledSkill {
    name: string;
    description?: string;
    alreadyExists?: boolean;
}

export function SkillsBundledPanel() {
    const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
    const [loading, setLoading] = useState(true);
    const [installing, setInstalling] = useState(false);
    const [selectedBundled, setSelectedBundled] = useState<Set<string>>(new Set());
    const [installSource, setInstallSource] = useState<'bundled' | 'github'>('bundled');
    const [githubUrl, setGithubUrl] = useState('');
    const [scanResult, setScanResult] = useState<any>(null);
    const [scanning, setScanning] = useState(false);

    const loadBundled = useCallback(() => {
        setLoading(true);
        fetchApi('/skills/bundled')
            .then((data: any) => {
                if (data?.skills) setBundledSkills(data.skills);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { loadBundled(); }, [loadBundled]);

    const toggleBundled = useCallback((name: string) => {
        setSelectedBundled(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    }, []);

    const handleInstallBundled = useCallback(async () => {
        const names = Array.from(selectedBundled);
        if (names.length === 0) return;
        setInstalling(true);
        try {
            await fetchApi('/skills/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'bundled', skills: names, replace: true }),
            });
            setSelectedBundled(new Set());
            loadBundled();
        } catch {
            // ignore
        } finally {
            setInstalling(false);
        }
    }, [selectedBundled, loadBundled]);

    const handleInstallAllBundled = useCallback(async () => {
        setInstalling(true);
        try {
            await fetchApi('/skills/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'bundled', replace: true }),
            });
            loadBundled();
        } catch {
            // ignore
        } finally {
            setInstalling(false);
        }
    }, [loadBundled]);

    const handleScanUrl = useCallback(async () => {
        if (!githubUrl.trim()) return;
        setScanning(true);
        setScanResult(null);
        try {
            const result = await fetchApi('/skills/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: githubUrl }),
            });
            setScanResult(result);
        } catch {
            setScanResult({ success: false, error: 'Scan failed' });
        } finally {
            setScanning(false);
        }
    }, [githubUrl]);

    const handleInstallFromUrl = useCallback(async () => {
        if (!scanResult?.skills?.length) return;
        setInstalling(true);
        try {
            await fetchApi('/skills/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: githubUrl, skillsToInstall: scanResult.skills, replace: true }),
            });
            setScanResult(null);
            setGithubUrl('');
            loadBundled();
        } catch {
            // ignore
        } finally {
            setInstalling(false);
        }
    }, [scanResult, githubUrl, loadBundled]);

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading bundled skills…</div>;
    }

    return (
        <div className="p-3 flex flex-col gap-4">
            {/* Source toggle */}
            <div className="flex items-center gap-2">
                <button
                    className={`text-xs px-3 py-1.5 rounded ${installSource === 'bundled' ? 'bg-[#0078d4] text-white' : 'bg-[#f3f3f3] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]'}`}
                    onClick={() => setInstallSource('bundled')}
                >
                    Built-in Skills
                </button>
                <button
                    className={`text-xs px-3 py-1.5 rounded ${installSource === 'github' ? 'bg-[#0078d4] text-white' : 'bg-[#f3f3f3] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]'}`}
                    onClick={() => setInstallSource('github')}
                >
                    GitHub URL
                </button>
            </div>

            {installSource === 'bundled' && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-[#848484]">{bundledSkills.length} bundled skill(s) available</div>
                        <button
                            className="text-xs px-2 py-1 bg-[#0078d4] text-white rounded disabled:opacity-50"
                            disabled={installing}
                            onClick={handleInstallAllBundled}
                        >
                            Install All
                        </button>
                    </div>
                    <ul className="flex flex-col gap-1.5">
                        {bundledSkills.map(skill => (
                            <li key={skill.name} className="flex items-center gap-2 px-3 py-2 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#2d2d2d]">
                                <input
                                    type="checkbox"
                                    checked={selectedBundled.has(skill.name)}
                                    onChange={() => toggleBundled(skill.name)}
                                    disabled={false}
                                    className="accent-[#0078d4]"
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">{skill.name}</span>
                                        {skill.alreadyExists && (
                                            <span className="text-[10px] bg-[#e6f4ea] dark:bg-[#0d3f1f] text-[#137333] dark:text-[#81c995] px-1.5 py-0.5 rounded">
                                                installed
                                            </span>
                                        )}
                                    </div>
                                    {skill.description && (
                                        <div className="text-xs text-[#616161] dark:text-[#999] truncate">{skill.description}</div>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    {selectedBundled.size > 0 && (
                        <button
                            className="mt-2 text-xs px-3 py-1.5 bg-[#0078d4] text-white rounded disabled:opacity-50"
                            disabled={installing}
                            onClick={handleInstallBundled}
                        >
                            Install Selected ({selectedBundled.size})
                        </button>
                    )}
                </div>
            )}

            {installSource === 'github' && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={githubUrl}
                            onChange={(e) => setGithubUrl(e.target.value)}
                            placeholder="https://github.com/user/repo or local path"
                            className="flex-1 text-sm px-2 py-1.5 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                        />
                        <button
                            className="text-xs px-3 py-1.5 bg-[#0078d4] text-white rounded disabled:opacity-50"
                            disabled={scanning || !githubUrl.trim()}
                            onClick={handleScanUrl}
                        >
                            {scanning ? 'Scanning…' : 'Scan'}
                        </button>
                    </div>
                    {scanResult && !scanResult.success && (
                        <div className="text-xs text-[#f14c4c]">{scanResult.error || 'Scan failed'}</div>
                    )}
                    {scanResult?.skills?.length > 0 && (
                        <div>
                            <div className="text-xs text-[#848484] mb-1">Found {scanResult.skills.length} skill(s):</div>
                            <ul className="flex flex-col gap-1">
                                {scanResult.skills.map((s: any) => (
                                    <li key={s.name} className="text-sm text-[#1e1e1e] dark:text-[#cccccc] px-2 py-1 bg-[#f3f3f3] dark:bg-[#333] rounded">
                                        {s.name} {s.description && <span className="text-xs text-[#848484]">— {s.description}</span>}
                                    </li>
                                ))}
                            </ul>
                            <button
                                className="mt-2 text-xs px-3 py-1.5 bg-[#0078d4] text-white rounded disabled:opacity-50"
                                disabled={installing}
                                onClick={handleInstallFromUrl}
                            >
                                Install All
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
