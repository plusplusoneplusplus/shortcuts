/**
 * TemplatesTab — displays saved (model, mode, skills) templates.
 * Clicking a card applies those settings and stays on the Templates tab,
 * showing the card visually selected (blue ring + checkmark).
 * The "Save current" button saves the current Advanced configuration as a new template.
 */

import React from 'react';
import type { SkillTemplate } from '../features/templates/hooks/useSkillTemplates';
import type { PostAction } from '../../../task-types';
import { TaskDefs } from '../../../../tasks/task-types';

interface TemplatesTabProps {
    templates: SkillTemplate[];
    loaded: boolean;
    currentModel: string;
    currentMode: 'ask' | 'task';
    currentSkills: string[];
    currentPostActions: PostAction[];
    selectedTemplateId: string | null;
    onSelect: (template: SkillTemplate) => void;
    onSave: () => void;
    onDelete: (id: string) => void;
}

export function TemplatesTab({
    templates,
    loaded,
    currentModel,
    currentMode,
    currentSkills,
    currentPostActions,
    selectedTemplateId,
    onSelect,
    onSave,
    onDelete,
}: TemplatesTabProps) {
    const canSave = !!currentModel || currentSkills.length > 0 || currentPostActions.length > 0;
    const filteredTemplates = templates.filter(t => t.mode === currentMode);

    if (!loaded) {
        return (
            <div className="flex items-center justify-center py-8 text-[#848484] text-sm">
                <span className="animate-spin mr-2">⟳</span> Loading…
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2">
            {/* Header */}
            <div className="flex items-center justify-between">
                <span className="text-xs text-[#848484]">Saved templates</span>
                <button
                    type="button"
                    onClick={onSave}
                    disabled={!canSave}
                    className="text-xs px-2 py-1 rounded border border-[#0078d4] text-[#0078d4] hover:bg-[#f0f7ff] dark:hover:bg-[#1e3a5f] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={canSave ? 'Save current model/mode/skills as a template' : 'Select a model or skill first'}
                    data-testid="save-template-btn"
                >
                    + Save current
                </button>
            </div>

            {filteredTemplates.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-[#848484] text-sm text-center px-4" data-testid="templates-empty-state">
                    <>No <strong className="mx-0.5">{currentMode}</strong> templates yet. Configure model/skills in Advanced, then click <strong className="mx-1">+ Save current</strong>.</>
                </div>
            ) : (
                <div className="flex flex-col gap-2 overflow-y-auto max-h-[360px]">
                    {filteredTemplates.map(t => {
                        const isSelected = t.id === selectedTemplateId;
                        return (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => onSelect(t)}
                            className={`text-left w-full rounded border transition-colors px-2 py-1 relative group ${
                                isSelected
                                    ? 'border-[#0078d4] ring-2 ring-[#0078d4]/30 bg-[#f0f7ff] dark:bg-[#1e3a5f]'
                                    : 'border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] hover:border-[#0078d4] hover:bg-[#f0f7ff] dark:hover:bg-[#1e3a5f]'
                            }`}
                            data-testid={`template-card-${t.id}`}
                        >
                            {/* Selected checkmark */}
                            {isSelected && (
                                <span
                                    className="absolute top-1 right-1 text-[#0078d4] text-xs leading-none"
                                    data-testid={`template-selected-${t.id}`}
                                >
                                    ✓
                                </span>
                            )}

                            {/* Delete button — shifts left when selected to make room for checkmark */}
                            <span
                                role="button"
                                tabIndex={0}
                                onClick={e => { e.stopPropagation(); onDelete(t.id); }}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onDelete(t.id); } }}
                                className={`absolute top-1 text-[#848484] hover:text-[#cc3333] opacity-0 group-hover:opacity-100 transition-opacity px-1 text-xs leading-none ${isSelected ? 'right-5' : 'right-1'}`}
                                title="Delete template"
                                data-testid={`template-delete-${t.id}`}
                            >
                                ×
                            </span>

                            {/* Mode badge + model tag + name — single row */}
                            <div className="flex items-center gap-1 flex-wrap pr-5 min-w-0">
                                <span className={`text-[10px] px-1 py-0.5 rounded-full font-medium shrink-0 ${
                                    t.mode === 'ask'
                                        ? 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1e3a5f] dark:text-[#93c5fd]'
                                        : 'bg-[#dcfce7] text-[#15803d] dark:bg-[#14532d] dark:text-[#86efac]'
                                }`}>
                                    {t.mode}
                                </span>
                                {t.model && (
                                    <span className="text-[10px] px-1 py-0.5 rounded font-mono bg-[#f3f3f3] dark:bg-[#3c3c3c] text-[#848484] shrink-0">
                                        {t.model}
                                    </span>
                                )}
                                {t.name && (
                                    <span className="text-[10px] font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate min-w-0">
                                        {t.name}
                                    </span>
                                )}
                            </div>

                            {/* Skill chips */}
                            {t.skills.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                    {t.skills.map(s => (
                                        <span
                                            key={s}
                                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded-full border border-[#e0e0e0] dark:border-[#555] bg-[#f9f9f9] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                        >
                                            <span>⚡</span>
                                            <span>{s}</span>
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Post-action chips */}
                            {t.postActions && t.postActions.length > 0 && (
                                <div className="flex flex-wrap gap-0.5 mt-0.5">
                                    {t.postActions.map((action, i) => (
                                        <span
                                            key={i}
                                            className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded-full border border-[#e0e0e0] dark:border-[#555] bg-[#f9f9f9] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                        >
                                            <span>{action.type === 'skill' ? '⚡' : '🔧'}</span>
                                            <span>{action.type === 'skill' ? action.skillName : action.script}</span>
                                            <span className="text-[#848484]">→ post</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
