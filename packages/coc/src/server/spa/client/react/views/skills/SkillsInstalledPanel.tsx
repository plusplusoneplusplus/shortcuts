/**
 * SkillsInstalledPanel — lists globally installed skills from GET /api/skills.
 * Each item shows name, version badge, description, toggle, and delete button.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchApi } from '../../hooks/useApi';
import { SkillListItem } from '../../shared';
import type { SkillInfo } from '../../shared';


export function SkillsInstalledPanel() {
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
    const [skillDetail, setSkillDetail] = useState<SkillInfo | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [disabledSkills, setDisabledSkills] = useState<string[]>([]);
    const [deleteConfirmName, setDeleteConfirmName] = useState<string | null>(null);

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
        fetchApi(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
            .then(() => {
                setSkills(prev => prev.filter(s => s.name !== name));
                setDeleteConfirmName(null);
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
            <div className="p-4 text-sm text-[#848484]" data-testid="skills-installed-empty">
                No global skills installed. Install from the <strong>Bundled</strong> tab or from a GitHub URL.
            </div>
        );
    }

    return (
        <div className="p-3">
            <div className="text-xs text-[#848484] mb-2">{skills.length} global skill(s) installed</div>
            <ul className="flex flex-col gap-2">
                {skills.map(skill => (
                    <SkillListItem
                        key={skill.name}
                        skill={skill}
                        isExpanded={expandedSkill === skill.name}
                        isEnabled={!disabledSkills.includes(skill.name)}
                        detail={skillDetail}
                        detailLoading={detailLoading}
                        deleteConfirm={deleteConfirmName === skill.name}
                        onExpand={() => handleExpandSkill(skill.name)}
                        onToggle={(enabled) => handleToggleSkill(skill.name, enabled)}
                        onDelete={() => handleDeleteSkill(skill.name)}
                        onSetDeleteConfirm={(c) => setDeleteConfirmName(c ? skill.name : null)}
                        testIdPrefix="skills-installed"
                    />
                ))}
            </ul>
        </div>
    );
}

