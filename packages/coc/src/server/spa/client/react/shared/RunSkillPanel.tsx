/**
 * RunSkillPanel — presentational component for selecting and running skills.
 * Supports two interaction modes:
 *   - 'multi'  — toggle chip selection + Submit button (FollowPromptDialog)
 *   - 'single' — click row → immediate callback  (BulkFollowPromptDialog)
 *
 * All state is lifted to the owner; this component never fetches data.
 */

import { Spinner } from '../ui';

export interface SkillItem {
    name: string;
    description?: string;
}

export interface RunSkillPanelProps {
    /** Available skills (pre-fetched by owner). */
    skills: SkillItem[];
    /** Recently-used skills (pre-fetched by owner). */
    recentItems: SkillItem[];
    /** Available model IDs (pre-fetched by owner). */
    models: string[];
    /** True while skills/models are being fetched. */
    loading: boolean;

    /** Currently toggled skills (only meaningful in 'multi' mode). */
    selectedSkills: string[];
    /** Value of the additional-info textarea. */
    additionalInfo: string;
    /** Currently selected model ID (empty string = default). */
    model: string;
    /** True while a submission is in progress. */
    submitting: boolean;
    /** Extra disabled flag (e.g. no files to queue). */
    disabled?: boolean;

    /** Called when a skill chip/row is toggled (multi) or clicked (single). */
    onSkillToggle: (name: string) => void;
    /** Called when skills should be submitted (multi: submit button / recent click; single: row/recent click). */
    onSubmitSkills: (names: string[]) => void;
    /** Called when the additional-info text changes. */
    onAdditionalInfoChange: (val: string) => void;
    /** Called when the model selection changes. */
    onModelChange: (val: string) => void;

    /** 'multi' = toggle chips + Submit; 'single' = click row → immediate. */
    selectionMode: 'multi' | 'single';
    /** Label for the submit button (multi mode only). Defaults to computed label. */
    submitLabel?: string;
    /** Message shown when no skills are found. */
    emptyMessage?: string;
    /** HTML id for the model <select>. */
    modelSelectId?: string;
    /** HTML id for the additional-info <textarea>. */
    additionalInfoId?: string;
    /** Content rendered between the model select and additional info (e.g. workspace switcher). */
    afterModelContent?: React.ReactNode;
}

const ENDEV_XDPU_SKILL_NAME = 'EnDev-xDpu';

export function RunSkillPanel({
    skills,
    recentItems,
    models,
    loading,
    selectedSkills,
    additionalInfo,
    model,
    submitting,
    disabled = false,
    onSkillToggle,
    onSubmitSkills,
    onAdditionalInfoChange,
    onModelChange,
    selectionMode,
    submitLabel,
    emptyMessage,
    modelSelectId,
    additionalInfoId,
    afterModelContent,
}: RunSkillPanelProps) {
    const isDisabled = submitting || disabled;
    const availableSkillNames = new Set(skills.map(s => s.name));
    const visibleRecentItems = recentItems.filter(item =>
        item.name !== ENDEV_XDPU_SKILL_NAME || availableSkillNames.has(item.name));
    const visibleSelectedSkills = selectedSkills.filter(name =>
        name !== ENDEV_XDPU_SKILL_NAME || availableSkillNames.has(name));

    return (
        <>
            {/* Model select */}
            <div className="flex flex-col gap-1">
                <label className="text-xs text-[#616161] dark:text-[#999]">
                    Model <span className="text-[#848484]">(optional)</span>
                </label>
                <select
                    id={modelSelectId}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                    value={model}
                    onChange={e => onModelChange(e.target.value)}
                >
                    <option value="">Default</option>
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            </div>

            {afterModelContent}

            {/* Additional info */}
            <div className="flex flex-col gap-1">
                <label className="text-xs text-[#616161] dark:text-[#999]">
                    Additional info <span className="text-[#848484]">(optional)</span>
                </label>
                <textarea
                    id={additionalInfoId}
                    className="w-full px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] resize-y"
                    rows={3}
                    placeholder="Extra context for the AI (e.g. &quot;focus on auth module&quot;)"
                    value={additionalInfo}
                    onChange={e => onAdditionalInfoChange(e.target.value)}
                    disabled={isDisabled}
                />
            </div>

            {/* Last Used section */}
            {visibleRecentItems.length > 0 && !loading && (
                <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Last Used</div>
                    {visibleRecentItems.map(item => (
                        <button
                            key={`skill-${item.name}`}
                            className="fp-item fp-recent-item w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
                            data-name={item.name}
                            disabled={isDisabled}
                            onClick={() => onSubmitSkills([item.name])}
                        >
                            <span>⚡</span>
                            <span className="truncate">{item.name}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Skills list */}
            {loading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-[#848484]">
                    <Spinner size="sm" /> Loading{selectionMode === 'single' ? ' skills' : ''}…
                </div>
            ) : skills.length === 0 ? (
                <div className="text-xs text-[#848484] py-2">
                    <p>{emptyMessage ?? 'No skills found in this workspace.'}</p>
                    <p className="mt-1 text-[10px]">Create skills in .github/skills/</p>
                </div>
            ) : selectionMode === 'multi' ? (
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Skills</div>
                        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="fp-skill-chips">
                            {skills.map(s => {
                                const isActive = visibleSelectedSkills.includes(s.name);
                                return (
                                    <button
                                        key={s.name}
                                        type="button"
                                        className={`fp-item inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-colors ${
                                            isActive
                                                ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                                : 'bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#555] hover:border-[#0078d4]'
                                        }`}
                                        data-name={s.name}
                                        disabled={isDisabled}
                                        onClick={() => onSkillToggle(s.name)}
                                        title={s.description || s.name}
                                    >
                                        <span>⚡</span>
                                        <span className="font-medium">{s.name}</span>
                                        {isActive && <span className="ml-0.5">✕</span>}
                                    </button>
                                );
                            })}
                        </div>
                        {visibleSelectedSkills.length > 0 && (
                            <button
                                type="button"
                                className="w-full px-3 py-1.5 text-xs font-medium text-white bg-[#0078d4] rounded hover:bg-[#006cc1] disabled:opacity-50"
                                disabled={isDisabled}
                                onClick={() => onSubmitSkills(visibleSelectedSkills)}
                                data-testid="fp-submit-skills"
                            >
                                {submitting
                                    ? 'Submitting…'
                                    : submitLabel ?? `Submit with ${visibleSelectedSkills.length} skill${visibleSelectedSkills.length > 1 ? 's' : ''}`}
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                /* single mode — click a row to immediately submit */
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                    <div>
                        <div className="text-[10px] uppercase tracking-wider text-[#848484] mb-1">Skills</div>
                        {skills.map(s => (
                            <button
                                key={s.name}
                                className="fp-item w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:opacity-50"
                                data-name={s.name}
                                disabled={isDisabled}
                                onClick={() => onSubmitSkills([s.name])}
                            >
                                <span>⚡</span>
                                <span className="flex-shrink-0 font-medium">{s.name}</span>
                                {s.description && (
                                    <span className="text-xs text-[#848484] truncate">{s.description}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
