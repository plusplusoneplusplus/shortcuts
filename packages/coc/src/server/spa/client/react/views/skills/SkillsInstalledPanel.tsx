/**
 * SkillsInstalledPanel — lists globally installed skills from GET /api/skills.
 * Each item shows name, version badge, description, toggle, and delete button.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../hooks/useApi';

interface SkillInfo {
    name: string;
    description?: string;
    version?: string;
    variables?: string[];
    output?: string[];
    promptBody?: string;
    references?: string[];
    scripts?: string[];
}

interface SkillDetail extends SkillInfo {
    // same shape, loaded on expand
}

export function SkillsInstalledPanel() {
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
    const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [disabledSkills, setDisabledSkills] = useState<string[]>([]);

    const loadSkills = useCallback(() => {
        setLoading(true);
        fetchApi('/skills')
            .then((data: any) => {
                if (data?.skills) setSkills(data.skills);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const loadConfig = useCallback(() => {
        fetchApi('/skills/config')
            .then((data: any) => {
                if (Array.isArray(data?.globalDisabledSkills)) {
                    setDisabledSkills(data.globalDisabledSkills);
                }
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        loadSkills();
        loadConfig();
    }, [loadSkills, loadConfig]);

    const handleExpandSkill = useCallback((name: string) => {
        if (expandedSkill === name) {
            setExpandedSkill(null);
            setSkillDetail(null);
            return;
        }
        setExpandedSkill(name);
        setDetailLoading(true);
        fetchApi(`/skills/${encodeURIComponent(name)}`)
            .then((data: any) => setSkillDetail(data?.skill ?? null))
            .catch(() => setSkillDetail(null))
            .finally(() => setDetailLoading(false));
    }, [expandedSkill]);

    const handleToggleSkill = useCallback((name: string, enabled: boolean) => {
        const updated = enabled
            ? disabledSkills.filter(s => s !== name)
            : [...disabledSkills, name];
        setDisabledSkills(updated);
        fetchApi('/skills/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ globalDisabledSkills: updated }),
        }).catch(() => {});
    }, [disabledSkills]);

    const handleDeleteSkill = useCallback((name: string) => {
        if (!confirm(`Delete global skill "${name}"?`)) return;
        fetchApi(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
            .then(() => {
                setSkills(prev => prev.filter(s => s.name !== name));
                if (expandedSkill === name) {
                    setExpandedSkill(null);
                    setSkillDetail(null);
                }
            })
            .catch(() => {});
    }, [expandedSkill]);

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading global skills…</div>;
    }

    if (skills.length === 0) {
        return (
            <div className="p-4 text-sm text-[#848484]">
                No global skills installed. Install from the <strong>Bundled</strong> tab or from a GitHub URL.
            </div>
        );
    }

    return (
        <div className="p-3">
            <div className="text-xs text-[#848484] mb-2">{skills.length} global skill(s) installed</div>
            <ul className="flex flex-col gap-2">
                {skills.map(skill => {
                    const isEnabled = !disabledSkills.includes(skill.name);
                    const isExpanded = expandedSkill === skill.name;
                    return (
                        <li key={skill.name} className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#2d2d2d]">
                            <div className="flex items-start justify-between px-3 py-2">
                                <div
                                    className="flex-1 min-w-0 cursor-pointer"
                                    onClick={() => handleExpandSkill(skill.name)}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                                            🧩 {skill.name}
                                        </span>
                                        {skill.version && (
                                            <span className="text-[10px] bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#1a73e8] dark:text-[#8ab4f8] px-1.5 py-0.5 rounded">
                                                v{skill.version}
                                            </span>
                                        )}
                                        <span className="text-[10px] text-[#848484]">
                                            {isExpanded ? '▼' : '▶'}
                                        </span>
                                    </div>
                                    {skill.description && (
                                        <div className="text-xs text-[#616161] dark:text-[#999] mt-0.5 truncate">
                                            {skill.description}
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 ml-2 shrink-0">
                                    <label className="inline-flex items-center gap-1 text-xs cursor-pointer" title={isEnabled ? 'Enabled' : 'Disabled'}>
                                        <input
                                            type="checkbox"
                                            checked={isEnabled}
                                            onChange={(e) => handleToggleSkill(skill.name, e.target.checked)}
                                            className="accent-[#0078d4]"
                                        />
                                    </label>
                                    <button
                                        onClick={() => handleDeleteSkill(skill.name)}
                                        className="text-xs text-[#f14c4c] hover:text-[#d32f2f] px-1"
                                        title="Delete skill"
                                    >
                                        🗑
                                    </button>
                                </div>
                            </div>
                            {isExpanded && (
                                <SkillDetailPanel detail={skillDetail} loading={detailLoading} />
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function SkillDetailPanel({ detail, loading }: { detail: SkillDetail | null; loading: boolean }) {
    if (loading) {
        return <div className="px-3 pb-3 text-xs text-[#848484]">Loading detail…</div>;
    }
    if (!detail) return null;

    return (
        <div className="px-3 pb-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-2 flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
                {detail.variables && detail.variables.length > 0 && (
                    <span className="text-[10px] bg-[#fef3e0] dark:bg-[#3c2e00] text-[#e37400] dark:text-[#fdd663] px-1.5 py-0.5 rounded">
                        {detail.variables.length} variable{detail.variables.length !== 1 ? 's' : ''}: {detail.variables.join(', ')}
                    </span>
                )}
                {detail.output && detail.output.length > 0 && (
                    <span className="text-[10px] bg-[#e6f4ea] dark:bg-[#0d3f1f] text-[#137333] dark:text-[#81c995] px-1.5 py-0.5 rounded">
                        output: {detail.output.join(', ')}
                    </span>
                )}
            </div>
            {detail.references && detail.references.length > 0 && (
                <div>
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">📎 References</div>
                    <div className="flex flex-wrap gap-1">
                        {detail.references.map(ref => (
                            <span key={ref} className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded font-mono">{ref}</span>
                        ))}
                    </div>
                </div>
            )}
            {detail.scripts && detail.scripts.length > 0 && (
                <div>
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">⚙️ Scripts</div>
                    <div className="flex flex-wrap gap-1">
                        {detail.scripts.map(script => (
                            <span key={script} className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded font-mono">{script}</span>
                        ))}
                    </div>
                </div>
            )}
            {detail.promptBody && (
                <div>
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">📝 Prompt</div>
                    <pre className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f9f9f9] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap font-mono">
                        {detail.promptBody}
                    </pre>
                </div>
            )}
        </div>
    );
}
