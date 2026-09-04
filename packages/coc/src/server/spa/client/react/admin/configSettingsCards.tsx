/**
 * configSettingsCards — presentational cards for the AI & Execution, Chat
 * Experience, and Appearance & Navigation settings sections.
 *
 * These are pure UI over the values owned by `useAdminConfigForm` and
 * `useAdminPreferencesForm`. They keep the shared primitives (`SettingsCard`,
 * `AdminRow`, `AdminToggle`, `AdminSeg`, `SourceBadge`, `AdminInputSuffix`)
 * and every existing id / data-testid unchanged.
 */
import { SettingsCard } from './SettingsCard';
import { AdminInputSuffix, AdminRow, AdminSeg, AdminToggle, SourceBadge } from './adminControls';
import { VALID_OUTPUT_OPTIONS, type ToolCompactness } from './useAdminConfigForm';
import type { TaskCardDensity, Theme, UiLayoutMode } from './useAdminPreferencesForm';

interface SourceProps {
    sources: Record<string, string>;
    isDefaultValue: (key: string) => boolean | undefined;
}

// ── AI & Execution ──────────────────────────────────────────────────────────
export interface AiExecutionCardProps extends SourceProps {
    configForm: Record<string, string>;
    setConfigForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
}

export function AiExecutionCard({ configForm, setConfigForm, dirty, saving, onSave, onCancel, sources, isDefaultValue }: AiExecutionCardProps) {
    return (
        <SettingsCard
            title="AI & Execution"
            description="Default model, parallelism, timeout, and output format for AI tasks."
            dirty={dirty}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
            data-testid="settings-ai-execution"
        >
            <AdminRow
                name="Model"
                hint="AI model identifier (leave blank to use server default)."
            >
                <input
                    id="admin-config-model"
                    className="ar-input ar-long ar-mono"
                    value={configForm.model}
                    onChange={e => setConfigForm(f => ({ ...f, model: e.target.value }))}
                />
                <SourceBadge source={sources['model']} isDefault={isDefaultValue('model')} />
            </AdminRow>
            <AdminRow
                name="Parallelism"
                hint="Number of parallel AI tasks. Read-write tasks always run sequentially."
            >
                <input
                    id="admin-config-parallel"
                    type="number"
                    min={1}
                    className="ar-input ar-short"
                    value={configForm.parallel}
                    onChange={e => setConfigForm(f => ({ ...f, parallel: e.target.value }))}
                />
                <SourceBadge source={sources['parallel']} isDefault={isDefaultValue('parallel')} />
            </AdminRow>
            <AdminRow
                name="Timeout"
                hint="Per-task wall-clock limit. Leave blank for the 6-hour default."
            >
                <AdminInputSuffix suffix="sec">
                    <input
                        id="admin-config-timeout"
                        type="number"
                        min={1}
                        placeholder="3600"
                        className="ar-input ar-short"
                        value={configForm.timeout}
                        onChange={e => setConfigForm(f => ({ ...f, timeout: e.target.value }))}
                    />
                </AdminInputSuffix>
                <SourceBadge source={sources['timeout']} isDefault={isDefaultValue('timeout')} />
            </AdminRow>
            <AdminRow
                name="Idle timeout"
                hint="Kills a session after this long with no streaming activity. Leave blank for the 1-hour default. Copilot sessions only."
            >
                <AdminInputSuffix suffix="sec">
                    <input
                        id="admin-config-idle-timeout"
                        type="number"
                        min={1}
                        placeholder="3600"
                        className="ar-input ar-short"
                        value={configForm.idleTimeout ?? ''}
                        onChange={e => setConfigForm(f => ({ ...f, idleTimeout: e.target.value }))}
                    />
                </AdminInputSuffix>
                <SourceBadge source={sources['idleTimeout']} isDefault={isDefaultValue('idleTimeout')} />
            </AdminRow>
            <AdminRow
                name="Output"
                hint="Default format for CLI commands that print structured data."
            >
                <select
                    id="admin-config-output"
                    className="ar-select ar-med"
                    value={configForm.output}
                    onChange={e => setConfigForm(f => ({ ...f, output: e.target.value }))}
                >
                    {VALID_OUTPUT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <SourceBadge source={sources['output']} isDefault={isDefaultValue('output')} />
            </AdminRow>
        </SettingsCard>
    );
}

// ── Chat Experience ─────────────────────────────────────────────────────────
export interface ChatExperienceCardProps extends SourceProps {
    chatFollowUpEnabled: boolean;
    setChatFollowUpEnabled: (v: boolean) => void;
    chatFollowUpCount: string;
    setChatFollowUpCount: (v: string) => void;
    chatAskUserEnabled: boolean;
    setChatAskUserEnabled: (v: boolean) => void;
    showReportIntent: boolean;
    setShowReportIntent: (v: boolean) => void;
    toolCompactness: ToolCompactness;
    setToolCompactness: (v: ToolCompactness) => void;
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
}

export function ChatExperienceCard({
    chatFollowUpEnabled, setChatFollowUpEnabled,
    chatFollowUpCount, setChatFollowUpCount,
    chatAskUserEnabled, setChatAskUserEnabled,
    showReportIntent, setShowReportIntent,
    toolCompactness, setToolCompactness,
    dirty, saving, onSave, onCancel, sources, isDefaultValue,
}: ChatExperienceCardProps) {
    return (
        <SettingsCard
            title="Chat Experience"
            description="Controls how the AI assistant behaves during conversations."
            dirty={dirty}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
            data-testid="settings-chat"
        >
            <AdminRow
                name="Follow-up suggestions"
                hint="Generate clickable next-question chips after each response."
            >
                <SourceBadge source={sources['chat.followUpSuggestions.enabled']} isDefault={isDefaultValue('chat.followUpSuggestions.enabled')} />
                <AdminToggle
                    checked={chatFollowUpEnabled}
                    onChange={setChatFollowUpEnabled}
                    data-testid="toggle-chat-followup-enabled"
                />
            </AdminRow>
            <AdminRow
                name="Count"
                hint="Number of follow-up suggestions to generate (1–5)."
            >
                <input
                    type="number"
                    min={1}
                    max={5}
                    className="ar-input ar-short"
                    value={chatFollowUpCount}
                    onChange={e => setChatFollowUpCount(e.target.value)}
                    data-testid="input-chat-followup-count"
                />
                <SourceBadge source={sources['chat.followUpSuggestions.count']} isDefault={isDefaultValue('chat.followUpSuggestions.count')} />
            </AdminRow>
            <AdminRow
                name="Ask user (interactive questions)"
                hint="Allow the AI to pause and ask the user a question mid-task instead of guessing."
            >
                <SourceBadge source={sources['chat.askUser.enabled']} isDefault={isDefaultValue('chat.askUser.enabled')} />
                <AdminToggle
                    checked={chatAskUserEnabled}
                    onChange={setChatAskUserEnabled}
                    data-testid="toggle-chat-askuser-enabled"
                />
            </AdminRow>
            <AdminRow
                name="Intent announcements"
                hint="Show the report_intent badge above each tool call (“I'm about to read X…”)."
            >
                <SourceBadge source={sources['showReportIntent']} isDefault={isDefaultValue('showReportIntent')} />
                <AdminToggle
                    checked={showReportIntent}
                    onChange={setShowReportIntent}
                    data-testid="toggle-show-report-intent"
                />
            </AdminRow>
            <AdminRow
                name="Tool call verbosity"
                hint="How much detail to show for each tool invocation in the transcript."
            >
                <SourceBadge source={sources['toolCompactness']} isDefault={isDefaultValue('toolCompactness')} />
                <AdminSeg<ToolCompactness>
                    value={toolCompactness}
                    onChange={setToolCompactness}
                    aria-label="Tool call verbosity"
                    options={[
                        { value: 0, label: 'Full', testId: 'tool-compactness-full' },
                        { value: 1, label: 'Compact', testId: 'tool-compactness-compact' },
                        { value: 2, label: 'Minimal', testId: 'tool-compactness-minimal' },
                        { value: 3, label: 'Whisper', testId: 'tool-compactness-whisper' },
                    ]}
                />
            </AdminRow>
        </SettingsCard>
    );
}

// ── Appearance & Navigation ─────────────────────────────────────────────────
export interface AppearanceCardProps extends SourceProps {
    theme: Theme;
    setTheme: (v: Theme) => void;
    uiLayoutMode: UiLayoutMode;
    setUiLayoutMode: (v: UiLayoutMode) => void;
    reposSidebarCollapsed: boolean;
    setReposSidebarCollapsed: (v: boolean) => void;
    htmlEmbedEnabled: boolean;
    setHtmlEmbedEnabled: (v: boolean) => void;
    promptAutocompleteEnabled: boolean;
    setPromptAutocompleteEnabled: (v: boolean) => void;
    promptAutocompleteAiEnabled: boolean;
    setPromptAutocompleteAiEnabled: (v: boolean) => void;
    taskCardDensity: TaskCardDensity;
    setTaskCardDensity: (v: TaskCardDensity) => void;
    historyGrouping: boolean;
    setHistoryGrouping: (v: boolean) => void;
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
}

export function AppearanceCard({
    theme, setTheme,
    uiLayoutMode, setUiLayoutMode,
    reposSidebarCollapsed, setReposSidebarCollapsed,
    htmlEmbedEnabled, setHtmlEmbedEnabled,
    promptAutocompleteEnabled, setPromptAutocompleteEnabled,
    promptAutocompleteAiEnabled, setPromptAutocompleteAiEnabled,
    taskCardDensity, setTaskCardDensity,
    historyGrouping, setHistoryGrouping,
    dirty, saving, onSave, onCancel, sources, isDefaultValue,
}: AppearanceCardProps) {
    return (
        <SettingsCard
            title="Appearance & Navigation"
            badge="Global"
            description="Theme, layout density, and navigation preferences."
            dirty={dirty}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
            data-testid="settings-appearance"
        >
            <AdminRow name="Theme" hint="Color scheme for this device. Auto follows the OS preference.">
                <select
                    className="ar-select ar-med"
                    value={theme}
                    onChange={e => setTheme(e.target.value as Theme)}
                    data-testid="pref-theme"
                >
                    <option value="auto">auto</option>
                    <option value="light">light</option>
                    <option value="dark">dark</option>
                </select>
            </AdminRow>
            <AdminRow name="UI Mode" hint="Classic shows the activity tab. Dev workflow uses chats, work items, and tasks.">
                <select
                    className="ar-select ar-long"
                    value={uiLayoutMode}
                    onChange={e => setUiLayoutMode(e.target.value as UiLayoutMode)}
                    data-testid="pref-ui-layout-mode"
                >
                    <option value="dev-workflow">Dev Workflow (Chats + Work Items + Tasks)</option>
                    <option value="classic">Classic (Activity)</option>
                </select>
            </AdminRow>
            <AdminRow
                name="Repos sidebar collapsed"
                hint="Whether the repos sidebar starts collapsed on load."
            >
                <AdminToggle
                    checked={reposSidebarCollapsed}
                    onChange={setReposSidebarCollapsed}
                    data-testid="pref-repos-sidebar-collapsed"
                />
            </AdminRow>
            <AdminRow
                name="Inline HTML previews"
                hint={<>Render local <span className="ar-mono">.html</span> links titled <span className="ar-mono">embed</span> as sandboxed chat previews.</>}
            >
                <AdminToggle
                    checked={htmlEmbedEnabled}
                    onChange={setHtmlEmbedEnabled}
                    data-testid="pref-html-embed-enabled"
                />
            </AdminRow>
            <AdminRow
                name="Prompt ghost text"
                hint="Show inline autocomplete in Queue Task and follow-up inputs."
            >
                <AdminToggle
                    checked={promptAutocompleteEnabled}
                    onChange={setPromptAutocompleteEnabled}
                    data-testid="pref-prompt-autocomplete-enabled"
                />
            </AdminRow>
            <AdminRow
                name="AI prompt ghost text"
                hint="Generate ghost text with AI using workspace-scoped user history. Disabled by default."
            >
                <AdminToggle
                    checked={promptAutocompleteAiEnabled}
                    disabled={!promptAutocompleteEnabled}
                    onChange={setPromptAutocompleteAiEnabled}
                    data-testid="pref-prompt-autocomplete-ai-enabled"
                />
            </AdminRow>
            <AdminRow
                name="Task card density"
                hint="Density of task cards in the activity tab."
            >
                <SourceBadge source={sources['taskCardDensity']} isDefault={isDefaultValue('taskCardDensity')} />
                <AdminSeg<TaskCardDensity>
                    value={taskCardDensity}
                    onChange={setTaskCardDensity}
                    aria-label="Task card density"
                    options={[
                        { value: 'compact', label: 'Compact', testId: 'task-card-density-compact' },
                        { value: 'dense', label: 'Dense', testId: 'task-card-density-dense' },
                    ]}
                />
            </AdminRow>
            <AdminRow
                name="History grouping"
                hint="Group related plan and autopilot tasks together in the history list."
            >
                <SourceBadge source={sources['historyGrouping']} isDefault={isDefaultValue('historyGrouping')} />
                <AdminToggle
                    checked={historyGrouping}
                    onChange={setHistoryGrouping}
                    data-testid="toggle-history-grouping"
                />
            </AdminRow>
        </SettingsCard>
    );
}
