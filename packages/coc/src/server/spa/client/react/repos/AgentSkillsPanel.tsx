/**
 * AgentSkillsPanel — Agent Skills section extracted from RepoCopilotTab.
 * Includes SkillDetailPanel and InstallSkillsDialog sub-components.
 */

import { useState, useEffect } from 'react';
import { Button } from '../shared';
import { useGlobalToast } from '../context/ToastContext';
import { getApiBase } from '../utils/config';

export interface Skill {
    name: string;
    description?: string;
    version?: string;
    variables?: string[];
    output?: string[];
    promptBody?: string;
    references?: string[];
    scripts?: string[];
    relativePath?: string;
}

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
}: AgentSkillsPanelProps) {
    const [showInstallDialog, setShowInstallDialog] = useState(false);

    const isSkillEnabled = (name: string) => !disabledSkills.includes(name);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Agent Skills</h2>
                    <p className="text-xs text-[#848484] mt-0.5">
                        AI prompt modules stored in <code className="font-mono bg-[#f3f3f3] dark:bg-[#333] px-1 rounded">.github/skills/</code>
                    </p>
                </div>
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
                </div>
            ) : (
                <ul className="flex flex-col gap-2" data-testid="skills-list">
                    {skills.map(skill => (
                        <li
                            key={skill.name}
                            className={`skill-item flex flex-col rounded border border-[#e0e0e0] dark:border-[#3c3c3c] hover:border-[#0078d4]/40 group${!isSkillEnabled(skill.name) ? ' opacity-60' : ''}`}
                            data-testid={`skill-item-${skill.name}`}
                        >
                            <div
                                className="flex items-start justify-between gap-3 p-3 cursor-pointer"
                                onClick={() => onExpandSkill(skill.name)}
                                data-testid={`skill-expand-${skill.name}`}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] flex items-center gap-2">
                                        📄 {skill.name}
                                        {skill.version && (
                                            <span className="text-[10px] text-[#848484] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded-full">v{skill.version}</span>
                                        )}
                                        <span className="text-[10px] text-[#848484]">{expandedSkill === skill.name ? '▾' : '▸'}</span>
                                    </div>
                                    {skill.description && (
                                        <div className="text-xs text-[#616161] dark:text-[#999999] mt-0.5 truncate">{skill.description}</div>
                                    )}
                                </div>
                                <div className="flex-shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                    <label className="relative inline-flex items-center cursor-pointer" title={isSkillEnabled(skill.name) ? 'Enabled' : 'Disabled'}>
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={isSkillEnabled(skill.name)}
                                            disabled={skillToggleSaving || skillsLoading}
                                            onChange={(e) => onSkillToggle(skill.name, e.target.checked)}
                                            data-testid={`skill-toggle-${skill.name}`}
                                        />
                                        <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                                    </label>
                                    {deleteConfirm === skill.name ? (
                                        <span className="flex items-center gap-1 text-xs">
                                            <span className="text-[#616161] dark:text-[#999]">Delete?</span>
                                            <button
                                                className="text-red-600 dark:text-red-400 hover:underline"
                                                onClick={() => onDeleteSkill(skill.name)}
                                                data-testid={`skill-delete-confirm-${skill.name}`}
                                            >Yes</button>
                                            <button
                                                className="text-[#616161] dark:text-[#999] hover:underline"
                                                onClick={() => onSetDeleteConfirm(null)}
                                            >No</button>
                                        </span>
                                    ) : (
                                        <button
                                            className="opacity-0 group-hover:opacity-100 text-[#616161] dark:text-[#999] hover:text-red-600 dark:hover:text-red-400 transition-opacity text-base leading-none"
                                            title={`Delete ${skill.name}`}
                                            onClick={() => onSetDeleteConfirm(skill.name)}
                                            data-testid={`skill-delete-btn-${skill.name}`}
                                        >
                                            🗑
                                        </button>
                                    )}
                                </div>
                            </div>
                            {expandedSkill === skill.name && (
                                <SkillDetailPanel detail={skillDetail} loading={detailLoading} />
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {showInstallDialog && (
                <InstallSkillsDialog
                    workspaceId={workspaceId}
                    onClose={() => setShowInstallDialog(false)}
                    onInstalled={() => { setShowInstallDialog(false); onInstalled(); }}
                />
            )}
        </div>
    );
}

// ============================================================================
// SkillDetailPanel
// ============================================================================

function SkillDetailPanel({ detail, loading }: { detail: SkillDetail | null; loading: boolean }) {
    if (loading) {
        return (
            <div className="px-3 pb-3 text-xs text-[#848484]" data-testid="skill-detail-loading">Loading detail...</div>
        );
    }
    if (!detail) return null;

    return (
        <div className="px-3 pb-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-2 flex flex-col gap-2" data-testid="skill-detail-panel">
            <div className="flex flex-wrap gap-1.5">
                {detail.version && (
                    <span className="text-[10px] bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#1a73e8] dark:text-[#8ab4f8] px-1.5 py-0.5 rounded" data-testid="skill-detail-version">
                        v{detail.version}
                    </span>
                )}
                {detail.variables && detail.variables.length > 0 && (
                    <span className="text-[10px] bg-[#fef3e0] dark:bg-[#3c2e00] text-[#e37400] dark:text-[#fdd663] px-1.5 py-0.5 rounded" data-testid="skill-detail-variables">
                        {detail.variables.length} variable{detail.variables.length !== 1 ? 's' : ''}: {detail.variables.join(', ')}
                    </span>
                )}
                {detail.output && detail.output.length > 0 && (
                    <span className="text-[10px] bg-[#e6f4ea] dark:bg-[#0d3f1f] text-[#137333] dark:text-[#81c995] px-1.5 py-0.5 rounded" data-testid="skill-detail-output">
                        output: {detail.output.join(', ')}
                    </span>
                )}
                {detail.relativePath && (
                    <span className="text-[10px] text-[#848484] font-mono" data-testid="skill-detail-path">
                        {detail.relativePath}
                    </span>
                )}
            </div>

            {detail.references && detail.references.length > 0 && (
                <div data-testid="skill-detail-references">
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">📎 References</div>
                    <div className="flex flex-wrap gap-1">
                        {detail.references.map(ref => (
                            <span key={ref} className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded font-mono">{ref}</span>
                        ))}
                    </div>
                </div>
            )}

            {detail.scripts && detail.scripts.length > 0 && (
                <div data-testid="skill-detail-scripts">
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">⚙️ Scripts</div>
                    <div className="flex flex-wrap gap-1">
                        {detail.scripts.map(script => (
                            <span key={script} className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded font-mono">{script}</span>
                        ))}
                    </div>
                </div>
            )}

            {detail.promptBody && (
                <div data-testid="skill-detail-prompt">
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">📝 Prompt</div>
                    <pre className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f9f9f9] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap font-mono">
                        {detail.promptBody}
                    </pre>
                </div>
            )}
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
        fetch(getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/skills/bundled')
            .then(r => r.json())
            .then(data => {
                const skills: BundledSkill[] = data.skills || [];
                setBundledSkills(skills);
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
            const res = await fetch(
                getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/skills/scan',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: githubUrl }),
                }
            );
            const data = await res.json();
            if (!data.success) {
                setScanError(data.error || 'Scan failed');
            } else {
                setScanResult(data);
                setSelectedGithub(new Set(data.skills.map((s: any) => s.name)));
            }
        } catch (err: any) {
            setScanError(err?.message ?? 'Scan failed');
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

            const res = await fetch(
                getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/skills/install',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                }
            );
            const result = await res.json();
            const installed = result.installed ?? 0;
            const failed = result.failed ?? 0;
            if (failed > 0) {
                addToast(`${installed} skill(s) installed, ${failed} failed`, 'error');
            } else {
                addToast(`${installed} skill(s) installed successfully`, 'success');
            }
            onInstalled();
        } catch (err: any) {
            addToast(err?.message ?? 'Installation failed', 'error');
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
