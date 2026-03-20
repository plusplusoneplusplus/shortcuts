/**
 * Shared SkillListItem — collapsed skill card row with toggle, delete, and expand.
 * Used by AgentSkillsPanel (repo skills) and SkillsInstalledPanel (global skills).
 */

import type { SkillInfo } from './SkillDetailPanel';
import { SkillDetailPanel } from './SkillDetailPanel';

export interface SkillListItemProps {
    skill: SkillInfo;
    isExpanded: boolean;
    isEnabled: boolean;
    detail: SkillInfo | null;
    detailLoading: boolean;
    deleteConfirm: boolean;
    onExpand: () => void;
    onToggle: (enabled: boolean) => void;
    onDelete: () => void;
    onSetDeleteConfirm: (confirming: boolean) => void;
    toggleDisabled?: boolean;
    testIdPrefix?: string;
}

export function SkillListItem({
    skill,
    isExpanded,
    isEnabled,
    detail,
    detailLoading,
    deleteConfirm,
    onExpand,
    onToggle,
    onDelete,
    onSetDeleteConfirm,
    toggleDisabled = false,
    testIdPrefix = 'skill',
}: SkillListItemProps) {
    return (
        <li
            className={`skill-item flex flex-col rounded border border-[#e0e0e0] dark:border-[#3c3c3c] hover:border-[#0078d4]/40 group${!isEnabled ? ' opacity-60' : ''}`}
            data-testid={`${testIdPrefix}-item-${skill.name}`}
        >
            <div
                className="flex items-start justify-between gap-3 p-3 cursor-pointer"
                onClick={onExpand}
                data-testid={`${testIdPrefix}-expand-${skill.name}`}
            >
                <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] flex items-center gap-2">
                        🧩 {skill.name}
                        {skill.version && (
                            <span className="text-[10px] bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#1a73e8] dark:text-[#8ab4f8] px-1.5 py-0.5 rounded">
                                v{skill.version}
                            </span>
                        )}
                        <span className="text-[10px] text-[#848484]">{isExpanded ? '▾' : '▸'}</span>
                    </div>
                    {skill.description && (
                        <div className="text-xs text-[#616161] dark:text-[#999999] mt-0.5 truncate">{skill.description}</div>
                    )}
                </div>
                <div className="flex-shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <label className="relative inline-flex items-center cursor-pointer" title={isEnabled ? 'Enabled' : 'Disabled'}>
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={isEnabled}
                            disabled={toggleDisabled}
                            onChange={(e) => onToggle(e.target.checked)}
                            data-testid={`${testIdPrefix}-toggle-${skill.name}`}
                        />
                        <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                    </label>
                    {deleteConfirm ? (
                        <span className="flex items-center gap-1 text-xs">
                            <span className="text-[#616161] dark:text-[#999]">Delete?</span>
                            <button
                                className="text-red-600 dark:text-red-400 hover:underline"
                                onClick={() => onDelete()}
                                data-testid={`${testIdPrefix}-delete-confirm-${skill.name}`}
                            >Yes</button>
                            <button
                                className="text-[#616161] dark:text-[#999] hover:underline"
                                onClick={() => onSetDeleteConfirm(false)}
                            >No</button>
                        </span>
                    ) : (
                        <button
                            className="opacity-0 group-hover:opacity-100 text-[#616161] dark:text-[#999] hover:text-red-600 dark:hover:text-red-400 transition-opacity text-base leading-none"
                            title={`Delete ${skill.name}`}
                            onClick={() => onSetDeleteConfirm(true)}
                            data-testid={`${testIdPrefix}-delete-btn-${skill.name}`}
                        >
                            🗑
                        </button>
                    )}
                </div>
            </div>
            {isExpanded && (
                <SkillDetailPanel detail={detail} loading={detailLoading} />
            )}
        </li>
    );
}
