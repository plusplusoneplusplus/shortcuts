/**
 * SkillsConfigPanel — global skill configuration.
 * Shows disabled skills list and global skills directory.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../hooks/useApi';

export function SkillsConfigPanel() {
    const [disabledSkills, setDisabledSkills] = useState<string[]>([]);
    const [globalDir, setGlobalDir] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [newDisabledSkill, setNewDisabledSkill] = useState('');

    const loadConfig = useCallback(() => {
        setLoading(true);
        fetchApi('/skills/config')
            .then((data: any) => {
                if (Array.isArray(data?.globalDisabledSkills)) {
                    setDisabledSkills(data.globalDisabledSkills);
                }
                if (data?.globalSkillsDir) {
                    setGlobalDir(data.globalSkillsDir);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { loadConfig(); }, [loadConfig]);

    const updateDisabledSkills = useCallback((updated: string[]) => {
        setDisabledSkills(updated);
        fetchApi('/skills/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ globalDisabledSkills: updated }),
        }).catch(() => {});
    }, []);

    const handleAddDisabled = useCallback(() => {
        const name = newDisabledSkill.trim();
        if (!name || disabledSkills.includes(name)) return;
        updateDisabledSkills([...disabledSkills, name]);
        setNewDisabledSkill('');
    }, [newDisabledSkill, disabledSkills, updateDisabledSkills]);

    const handleRemoveDisabled = useCallback((name: string) => {
        updateDisabledSkills(disabledSkills.filter(s => s !== name));
    }, [disabledSkills, updateDisabledSkills]);

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading config…</div>;
    }

    return (
        <div className="p-4 flex flex-col gap-4 max-w-lg">
            {/* Global skills directory */}
            <div>
                <label className="block text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                    Global Skills Directory
                </label>
                <div className="text-sm font-mono text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-3 py-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {globalDir || '~/.coc/skills/'}
                </div>
            </div>

            {/* Globally disabled skills */}
            <div>
                <label className="block text-xs font-medium text-[#616161] dark:text-[#999] mb-1">
                    Globally Disabled Skills
                </label>
                <div className="text-xs text-[#848484] mb-2">
                    Skills listed here are disabled across all workspaces. Per-repo disabled skills are managed in each repo&apos;s Copilot settings.
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                    {disabledSkills.map(name => (
                        <span
                            key={name}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-[#f14c4c]/10 text-[#f14c4c] border border-[#f14c4c]/30"
                        >
                            {name}
                            <button
                                onClick={() => handleRemoveDisabled(name)}
                                className="hover:text-[#d32f2f] ml-0.5"
                                title="Re-enable"
                            >
                                ✕
                            </button>
                        </span>
                    ))}
                    {disabledSkills.length === 0 && (
                        <span className="text-xs text-[#848484]">No globally disabled skills.</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newDisabledSkill}
                        onChange={(e) => setNewDisabledSkill(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddDisabled()}
                        placeholder="Skill name to disable…"
                        className="flex-1 text-sm px-2 py-1.5 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                    />
                    <button
                        className="text-xs px-3 py-1.5 bg-[#f14c4c] text-white rounded disabled:opacity-50"
                        disabled={!newDisabledSkill.trim()}
                        onClick={handleAddDisabled}
                    >
                        Disable
                    </button>
                </div>
            </div>
        </div>
    );
}
