/**
 * RepoPreferencesSection — Editable per-repo preferences form with auto-save.
 * Sections: Models, Execution, Skills, Advanced (linked repos).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { usePreferences, type SkillMode, type ModelMode } from '../../hooks/preferences/usePreferences';
import { useModels, type ModelInfo } from '../../hooks/useModels';
import { useFilesViewMode } from '../git/hooks/useFilesViewMode';
import { useUiLayoutMode } from '../../hooks/preferences/useUiLayoutMode';
import { useRemoteShell } from '../../hooks/preferences/useRemoteShell';
import { useGlobalToast } from '../../contexts/ToastContext';
import { useRepos } from '../../contexts/ReposContext';
import { SkillPicker, type SkillOption } from '../../queue/SkillPicker';
import { getSpaCocClient } from '../../api/cocClient';

interface RepoPreferencesSectionProps {
    workspaceId: string;
}

const labelClass = 'text-xs w-28 shrink-0 text-[#616161] dark:text-[#999]';
const selectClass = 'flex-1 px-2 py-0.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] w-full';
const sectionHeadClass = 'text-xs font-semibold text-[#616161] dark:text-[#999] uppercase tracking-wide mb-2';
const dividerClass = 'border-t border-[#e0e0e0] dark:border-[#3c3c3c] my-3';

const MODE_LABELS: Record<string, string> = {
    task: 'Task',
    ask: 'Ask',
    note: 'Note',
    schedule: 'Schedule',
    followUp: 'Follow-up',
    memory: 'Memory',
};

export function RepoPreferencesSection({ workspaceId }: RepoPreferencesSectionProps) {
    const { addToast } = useGlobalToast();
    const prefs = usePreferences(workspaceId);
    const { models: availableModels, loading: modelsLoading } = useModels();
    const { mode: filesViewMode, setMode: setFilesViewMode } = useFilesViewMode(workspaceId);
    const [uiLayoutMode, setUiLayoutMode] = useUiLayoutMode();
    const [remoteShell, setRemoteShell] = useRemoteShell();
    const { repos } = useRepos();

    // Available skills
    const [availableSkills, setAvailableSkills] = useState<SkillOption[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);

    // Linked repos
    const [linkedRepoIds, setLinkedRepoIds] = useState<string[]>([]);
    const [linkedRepoLoading, setLinkedRepoLoading] = useState(true);
    const [showAddRepo, setShowAddRepo] = useState(false);

    const fetchAvailableSkills = useCallback(async () => {
        setSkillsLoading(true);
        try {
            const data = await getSpaCocClient().skills.listAllWorkspace(workspaceId);
            setAvailableSkills(data.merged ?? []);
        } catch {
            setAvailableSkills([]);
        } finally {
            setSkillsLoading(false);
        }
    }, [workspaceId]);

    // Fetch available skills
    useEffect(() => {
        fetchAvailableSkills();
    }, [fetchAvailableSkills]);

    // Default model preferences
    const [defaultModel, setDefaultModelState] = useState('');
    const [defaultModels, setDefaultModelsState] = useState<Record<string, string>>({});
    const [showPerModeDefaults, setShowPerModeDefaults] = useState(false);

    // Fetch linked repo IDs from preferences
    useEffect(() => {
        setLinkedRepoLoading(true);
        getSpaCocClient().preferences.getRepo(workspaceId)
            .then(data => {
                setLinkedRepoIds(data?.linkedRepoIds ?? []);
                setDefaultModelState(typeof data?.defaultModel === 'string' ? data.defaultModel : '');
                const dm = data?.defaultModels;
                if (dm && typeof dm === 'object') {
                    const cleaned: Record<string, string> = {};
                    for (const [k, v] of Object.entries(dm)) {
                        if (typeof v === 'string' && v) cleaned[k] = v;
                    }
                    setDefaultModelsState(cleaned);
                }
            })
            .catch(() => setLinkedRepoIds([]))
            .finally(() => setLinkedRepoLoading(false));
    }, [workspaceId]);

    // Enabled models for dropdowns
    const enabledModels = availableModels.filter(m => m.enabled);

    // Model change handlers
    const handleModelChange = useCallback((mode: ModelMode, value: string) => {
        prefs.setModel(mode, value === 'default' ? '' : value);
    }, [prefs]);

    // Depth/effort change handlers
    const handleDepthChange = useCallback((value: string) => {
        prefs.setDepth(value === 'default' ? '' : value);
    }, [prefs]);

    const handleEffortChange = useCallback((value: string) => {
        prefs.setEffort(value === 'default' ? '' : value);
    }, [prefs]);

    // Skill toggle handler — toggles a skill in/out for the given mode
    const handleSkillToggle = useCallback((mode: SkillMode, name: string) => {
        const current = prefs.skills[mode];
        const next = current.includes(name)
            ? current.filter(s => s !== name)
            : [...current, name];
        prefs.setSkill(mode, next);
    }, [prefs]);

    // Linked repos handlers
    const handleRemoveLinkedRepo = useCallback(async (repoId: string) => {
        const nextIds = linkedRepoIds.filter(id => id !== repoId);
        const prevIds = linkedRepoIds;
        setLinkedRepoIds(nextIds);
        try {
            await getSpaCocClient().preferences.patchRepo(workspaceId, { linkedRepoIds: nextIds });
        } catch (e: any) {
            setLinkedRepoIds(prevIds);
            addToast(e?.message ?? 'Failed to save linked repos', 'error');
        }
    }, [workspaceId, linkedRepoIds, addToast]);

    const handleAddLinkedRepo = useCallback(async (repoId: string) => {
        const nextIds = [...linkedRepoIds, repoId];
        const prevIds = linkedRepoIds;
        setLinkedRepoIds(nextIds);
        setShowAddRepo(false);
        try {
            await getSpaCocClient().preferences.patchRepo(workspaceId, { linkedRepoIds: nextIds });
        } catch (e: any) {
            setLinkedRepoIds(prevIds);
            addToast(e?.message ?? 'Failed to save linked repos', 'error');
        }
    }, [workspaceId, linkedRepoIds, addToast]);

    // Default model handlers
    const handleDefaultModelChange = useCallback((value: string) => {
        const v = value === 'default' ? '' : value;
        setDefaultModelState(v);
        getSpaCocClient().preferences.patchRepo(workspaceId, { defaultModel: v }).catch(() => {});
    }, [workspaceId]);

    const handleDefaultModelModeChange = useCallback((mode: string, value: string) => {
        const v = value === 'repo-default' ? '' : value;
        setDefaultModelsState(prev => {
            const next = { ...prev };
            if (v) {
                next[mode] = v;
            } else {
                delete next[mode];
            }
            return next;
        });
        getSpaCocClient().preferences.patchRepo(workspaceId, { defaultModels: { [mode]: v } }).catch(() => {});
    }, [workspaceId]);

    // Available repos for linked repo picker (exclude self and already-linked)
    const linkableRepos = repos
        .map(r => r.workspace)
        .filter(w => w.id !== workspaceId && !linkedRepoIds.includes(w.id));

    // Loading state
    if (!prefs.loaded || modelsLoading) {
        return (
            <div id="repo-preferences-section" data-testid="repo-preferences-section">
                <div className="text-xs text-[#848484]" data-testid="repo-preferences-loading">Loading…</div>
            </div>
        );
    }

    return (
        <div id="repo-preferences-section" data-testid="repo-preferences-section">
            {/* ── Default Model ── */}
            <div className={sectionHeadClass} data-testid="section-default-model">Default Model</div>
            <div className="flex flex-col gap-2 mb-1">
                <div className="flex flex-col gap-0.5">
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                        <label className={labelClass}>Repo Default</label>
                        <select
                            className={selectClass}
                            value={defaultModel || 'default'}
                            onChange={e => handleDefaultModelChange(e.target.value)}
                            data-testid="pref-default-model"
                        >
                            <option value="default">CLI default</option>
                            {enabledModels.map(m => (
                                <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                            ))}
                        </select>
                    </div>
                    <p className="text-[11px] text-[#848484] ml-28 pl-2">
                        Fallback model when no explicit model is selected for a task.
                    </p>
                </div>
                <button
                    className="text-xs text-[#0078d4] hover:underline text-left ml-28 pl-2"
                    onClick={() => setShowPerModeDefaults(prev => !prev)}
                    data-testid="toggle-per-mode-defaults"
                >
                    {showPerModeDefaults ? '▾ Per-mode overrides' : '▸ Per-mode overrides'}
                </button>
                {showPerModeDefaults && (
                    <div className="flex flex-col gap-2 ml-4">
                        {(['task', 'ask', 'note', 'schedule', 'followUp', 'memory'] as const).map(mode => (
                            <div key={mode} className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                                <label className={labelClass}>{MODE_LABELS[mode]}</label>
                                <select
                                    className={selectClass}
                                    value={defaultModels[mode] || 'repo-default'}
                                    onChange={e => handleDefaultModelModeChange(mode, e.target.value)}
                                    data-testid={`pref-default-model-${mode}`}
                                >
                                    <option value="repo-default">Use repo default</option>
                                    {enabledModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                                    ))}
                                </select>
                            </div>
                        ))}
                        <p className="text-[11px] text-[#848484] ml-28 pl-2">
                            Precedence: explicit selection &gt; per-mode default &gt; repo default &gt; CLI default
                        </p>
                    </div>
                )}
            </div>

            <div className={dividerClass} />

            {/* ── Models ── */}
            <div className={sectionHeadClass} data-testid="section-models">Last Used Models</div>
            <div className="flex flex-col gap-2 mb-1">
                <ModelRow label="Task Model" mode="task" value={prefs.models.task} models={enabledModels} onChange={handleModelChange} />
                <ModelRow label="Ask Model" mode="ask" value={prefs.models.ask} models={enabledModels} onChange={handleModelChange} />
                <ModelRow label="Note Model" mode="note" value={prefs.models.note} models={enabledModels} onChange={handleModelChange} helperText="Model used when creating or chatting in notes for this repo." />
            </div>

            <div className={dividerClass} />

            {/* ── Execution ── */}
            <div className={sectionHeadClass} data-testid="section-execution">Execution</div>
            <div className="flex flex-col gap-2 mb-1">
                <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                    <label className={labelClass}>Depth</label>
                    <select
                        className={selectClass}
                        value={prefs.depth || 'default'}
                        onChange={e => handleDepthChange(e.target.value)}
                        data-testid="pref-depth"
                    >
                        <option value="default">default</option>
                        <option value="normal">normal</option>
                        <option value="deep">deep</option>
                    </select>
                </div>
                <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                    <label className={labelClass}>Effort</label>
                    <select
                        className={selectClass}
                        value={prefs.effort || 'default'}
                        onChange={e => handleEffortChange(e.target.value)}
                        data-testid="pref-effort"
                    >
                        <option value="default">default</option>
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                    </select>
                </div>
                <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                    <label className={labelClass}>File List View</label>
                    <select
                        className={selectClass}
                        value={filesViewMode}
                        onChange={e => setFilesViewMode(e.target.value as 'flat' | 'tree')}
                        data-testid="pref-files-view-mode"
                    >
                        <option value="tree">tree</option>
                        <option value="flat">flat</option>
                    </select>
                </div>
                <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                    <label className={labelClass}>UI Mode</label>
                    <select
                        className={selectClass}
                        value={uiLayoutMode}
                        onChange={e => setUiLayoutMode(e.target.value as 'classic' | 'dev-workflow')}
                        data-testid="pref-ui-layout-mode"
                    >
                        <option value="dev-workflow">Dev Workflow (Chats + Work Items + Tasks)</option>
                        <option value="classic">Classic (Activity)</option>
                    </select>
                </div>
                <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                    <label className={labelClass}>Remote Shell</label>
                    <select
                        className={selectClass}
                        value={remoteShell ? 'on' : 'off'}
                        onChange={e => setRemoteShell(e.target.value === 'on')}
                        data-testid="pref-remote-shell"
                    >
                        <option value="off">Off (classic repo tabs)</option>
                        <option value="on">On (remote-first 2-row shell)</option>
                    </select>
                </div>
                <RalphMaxIterationsRow
                    value={prefs.maxRalphIterations}
                    onChange={prefs.setMaxRalphIterations}
                />
            </div>

            <div className={dividerClass} />

            {/* ── Skills ── */}
            <div className={sectionHeadClass} data-testid="section-skills">Skills</div>
            {skillsLoading ? (
                <div className="text-xs text-[#848484]">Loading skills…</div>
            ) : (
                <div className="flex flex-col gap-3 mb-1">
                    <div className="flex flex-col md:flex-row items-start gap-1 md:gap-2">
                        <label className={`${labelClass} mt-0.5`}>Task Skill</label>
                        <div className="flex-1 min-w-0" data-testid="pref-skill-task">
                            <SkillPicker
                                label=""
                                skills={availableSkills}
                                selectedSkills={prefs.skills.task}
                                onSkillChange={(name) => handleSkillToggle('task', name)}
                            />
                        </div>
                    </div>
                    <div className="flex flex-col md:flex-row items-start gap-1 md:gap-2">
                        <label className={`${labelClass} mt-0.5`}>Ask Skill</label>
                        <div className="flex-1 min-w-0" data-testid="pref-skill-ask">
                            <SkillPicker
                                label=""
                                skills={availableSkills}
                                selectedSkills={prefs.skills.ask}
                                onSkillChange={(name) => handleSkillToggle('ask', name)}
                            />
                        </div>
                    </div>
                </div>
            )}

            <div className={dividerClass} />

            {/* ── Advanced ── */}
            <div className={sectionHeadClass} data-testid="section-advanced">Advanced</div>
            <div className="flex flex-col gap-2 mb-1">
                <div className="flex flex-col md:flex-row items-start gap-1 md:gap-2">
                    <label className={`${labelClass} mt-0.5`}>Linked Repos</label>
                    <div className="flex-1 min-w-0">
                        {linkedRepoLoading ? (
                            <div className="text-xs text-[#848484]">Loading…</div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-1.5" data-testid="linked-repos-chips">
                                {linkedRepoIds.map(id => {
                                    const repoName = repos.find(r => r.workspace.id === id)?.workspace.name ?? id;
                                    return (
                                        <span
                                            key={id}
                                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border border-[#e0e0e0] dark:border-[#555] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid={`linked-repo-${id}`}
                                        >
                                            {repoName}
                                            <button
                                                type="button"
                                                className="ml-0.5 text-[#848484] hover:text-red-500 transition-colors"
                                                onClick={() => handleRemoveLinkedRepo(id)}
                                                title={`Remove ${repoName}`}
                                                data-testid={`remove-linked-repo-${id}`}
                                            >
                                                ✕
                                            </button>
                                        </span>
                                    );
                                })}
                                {linkedRepoIds.length === 0 && !showAddRepo && (
                                    <span className="text-xs text-[#848484]">None</span>
                                )}
                                {showAddRepo ? (
                                    <LinkedRepoDropdown
                                        repos={linkableRepos}
                                        onSelect={handleAddLinkedRepo}
                                        onCancel={() => setShowAddRepo(false)}
                                    />
                                ) : (
                                    linkableRepos.length > 0 && (
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border border-[#e0e0e0] dark:border-[#555] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] hover:border-[#0078d4] transition-colors"
                                            onClick={() => setShowAddRepo(true)}
                                            data-testid="add-linked-repo"
                                        >
                                            + Add
                                        </button>
                                    )
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer note */}
            <div className="mt-4 text-[11px] text-[#848484]" data-testid="auto-save-note">
                Changes are saved automatically.
            </div>
        </div>
    );
}

// ── Sub-components ──────────────────────────────────────────────────────────

const RALPH_MAX_ITERATIONS_DEFAULT = 20;
const RALPH_MAX_ITERATIONS_MIN = 1;
const RALPH_MAX_ITERATIONS_MAX = 200;

function RalphMaxIterationsRow({ value, onChange }: {
    value: number | undefined;
    onChange: (n: number | undefined) => void;
}) {
    const [text, setText] = useState<string>(value !== undefined ? String(value) : '');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setText(value !== undefined ? String(value) : '');
        setError(null);
    }, [value]);

    const commit = useCallback((raw: string) => {
        const trimmed = raw.trim();
        if (trimmed === '') {
            setError(null);
            // Empty clears back to server default; we don't currently support
            // patch-clear via the server, so leave the saved value as-is.
            return;
        }
        const n = Number(trimmed);
        if (!Number.isInteger(n) || n < RALPH_MAX_ITERATIONS_MIN || n > RALPH_MAX_ITERATIONS_MAX) {
            setError(`Enter an integer between ${RALPH_MAX_ITERATIONS_MIN} and ${RALPH_MAX_ITERATIONS_MAX}`);
            return;
        }
        setError(null);
        if (n !== value) onChange(n);
    }, [value, onChange]);

    return (
        <div className="flex flex-col gap-0.5" data-testid="pref-max-ralph-iterations-row">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                <label className={labelClass}>Ralph max iterations</label>
                <input
                    type="number"
                    min={RALPH_MAX_ITERATIONS_MIN}
                    max={RALPH_MAX_ITERATIONS_MAX}
                    step={1}
                    placeholder={String(RALPH_MAX_ITERATIONS_DEFAULT)}
                    className={selectClass}
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onBlur={e => commit(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            commit((e.target as HTMLInputElement).value);
                        }
                    }}
                    data-testid="pref-max-ralph-iterations"
                />
            </div>
            {error ? (
                <p
                    className="text-[11px] text-red-600 dark:text-red-400 ml-28 pl-2"
                    data-testid="pref-max-ralph-iterations-error"
                >
                    {error}
                </p>
            ) : (
                <p className="text-[11px] text-[#848484] ml-28 pl-2">
                    How many iterations a Ralph loop runs before stopping. Can be extended later from the report page.
                </p>
            )}
        </div>
    );
}

function ModelRow({ label, mode, value, models, onChange, helperText }: {
    label: string;
    mode: ModelMode;
    value: string;
    models: ModelInfo[];
    onChange: (mode: ModelMode, value: string) => void;
    helperText?: string;
}) {
    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                <label className={labelClass}>{label}</label>
                <select
                    className={selectClass}
                    value={value || 'default'}
                    onChange={e => onChange(mode, e.target.value)}
                    data-testid={`pref-model-${mode}`}
                >
                    <option value="default">default</option>
                    {models.map(m => (
                        <option key={m.id} value={m.id}>{m.name ?? m.id}</option>
                    ))}
                </select>
            </div>
            {helperText && (
                <p className="text-[11px] text-[#848484] ml-28 pl-2">{helperText}</p>
            )}
        </div>
    );
}

function LinkedRepoDropdown({ repos, onSelect, onCancel }: {
    repos: { id: string; name?: string }[];
    onSelect: (id: string) => void;
    onCancel: () => void;
}) {
    return (
        <select
            className="px-2 py-1 text-xs rounded border border-[#0078d4] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none"
            autoFocus
            defaultValue=""
            onChange={e => {
                if (e.target.value) onSelect(e.target.value);
            }}
            onBlur={onCancel}
            data-testid="linked-repo-select"
        >
            <option value="" disabled>Select repo…</option>
            {repos.map(r => (
                <option key={r.id} value={r.id}>{r.name ?? r.id}</option>
            ))}
        </select>
    );
}
