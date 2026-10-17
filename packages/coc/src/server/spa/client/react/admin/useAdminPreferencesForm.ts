/**
 * useAdminPreferencesForm — controller for the "Appearance & Navigation" card.
 *
 * Owns the global-preference values (theme, sidebar, HTML embed,
 * prompt autocomplete) plus the config-backed display values
 * (taskCardDensity, historyGrouping, showReportIntent, toolCompactness). The
 * card hydrates from two sources — the
 * resolved admin config and the global preferences endpoint — so it exposes
 * two hydrate helpers that each patch the shared dirty snapshot.
 */
import { useCallback, useState } from 'react';
import { getSpaCocClientErrorMessage } from '../api/cocClient';
import { invalidateDisplaySettings } from '../hooks/preferences/useDisplaySettings';
import { invalidateHtmlEmbedPreference } from '../hooks/preferences/useHtmlEmbedPreference';
import { useAdminServer } from './adminTarget';

export type Theme = 'light' | 'dark' | 'auto';
export type TaskCardDensity = 'compact' | 'dense';
export type ToolCompactness = 0 | 1 | 2 | 3;

interface AppearanceSnapshot {
    theme: string;
    reposSidebarCollapsed: boolean;
    htmlEmbedEnabled: boolean;
    promptAutocompleteEnabled: boolean;
    promptAutocompleteAiEnabled: boolean;
    taskCardDensity: TaskCardDensity;
    historyGrouping: boolean;
    showReportIntent: boolean;
    toolCompactness: ToolCompactness;
}

export interface UseAdminPreferencesFormOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
}

export function useAdminPreferencesForm({ addToast }: UseAdminPreferencesFormOptions) {
    const adminServer = useAdminServer();
    const [theme, setTheme] = useState<Theme>('auto');
    const [reposSidebarCollapsed, setReposSidebarCollapsed] = useState(false);
    const [htmlEmbedEnabled, setHtmlEmbedEnabled] = useState(true);
    const [promptAutocompleteEnabled, setPromptAutocompleteEnabled] = useState(false);
    const [promptAutocompleteAiEnabled, setPromptAutocompleteAiEnabled] = useState(false);
    const [taskCardDensity, setTaskCardDensity] = useState<TaskCardDensity>('dense');
    const [historyGrouping, setHistoryGrouping] = useState(true);
    const [showReportIntent, setShowReportIntent] = useState(false);
    const [toolCompactness, setToolCompactness] = useState<ToolCompactness>(3);
    const [appearanceSaving, setAppearanceSaving] = useState(false);
    const [appearanceSnapshot, setAppearanceSnapshot] = useState<AppearanceSnapshot>({
        theme: 'auto',
        reposSidebarCollapsed: false,
        htmlEmbedEnabled: true,
        promptAutocompleteEnabled: false,
        promptAutocompleteAiEnabled: false,
        taskCardDensity: 'compact',
        historyGrouping: true,
        showReportIntent: false,
        toolCompactness: 3,
    });

    /** Loads the config-backed display values. */
    const hydrateFromConfig = useCallback((resolved: any) => {
        const tcd = (resolved.taskCardDensity === 'dense' ? 'dense' : 'compact') as TaskCardDensity;
        const hg = resolved.historyGrouping ?? true;
        const sri = resolved.showReportIntent ?? false;
        const tc = (resolved.toolCompactness ?? 1) as ToolCompactness;
        setTaskCardDensity(tcd);
        setHistoryGrouping(hg);
        setShowReportIntent(sri);
        setToolCompactness(tc);
        setAppearanceSnapshot(prev => ({ ...prev, taskCardDensity: tcd, historyGrouping: hg, showReportIntent: sri, toolCompactness: tc }));
    }, []);

    /** Loads the global-preference values (theme, embeds, autocomplete). */
    const hydrateFromPreferences = useCallback((data: any) => {
        const t = (data.theme ?? 'auto') as Theme;
        const r = data.reposSidebarCollapsed ?? false;
        const h = data.htmlEmbed?.enabled !== false;
        const pae = data.promptAutocomplete?.enabled === true;
        const paai = data.promptAutocomplete?.ai?.enabled === true;
        setTheme(t);
        setReposSidebarCollapsed(r);
        setHtmlEmbedEnabled(h);
        setPromptAutocompleteEnabled(pae);
        setPromptAutocompleteAiEnabled(paai);
        setAppearanceSnapshot(prev => ({
            ...prev,
            theme: t,
            reposSidebarCollapsed: r,
            htmlEmbedEnabled: h,
            promptAutocompleteEnabled: pae,
            promptAutocompleteAiEnabled: paai,
        }));
    }, []);

    const appearanceDirty = theme !== appearanceSnapshot.theme ||
        reposSidebarCollapsed !== appearanceSnapshot.reposSidebarCollapsed ||
        htmlEmbedEnabled !== appearanceSnapshot.htmlEmbedEnabled ||
        promptAutocompleteEnabled !== appearanceSnapshot.promptAutocompleteEnabled ||
        promptAutocompleteAiEnabled !== appearanceSnapshot.promptAutocompleteAiEnabled ||
        taskCardDensity !== appearanceSnapshot.taskCardDensity ||
        historyGrouping !== appearanceSnapshot.historyGrouping ||
        showReportIntent !== appearanceSnapshot.showReportIntent ||
        toolCompactness !== appearanceSnapshot.toolCompactness;

    const handleSaveAppearance = useCallback(async () => {
        setAppearanceSaving(true);
        try {
            // Save preferences (theme, reposSidebarCollapsed, htmlEmbed)
            const prefsChanged = theme !== appearanceSnapshot.theme ||
                reposSidebarCollapsed !== appearanceSnapshot.reposSidebarCollapsed ||
                htmlEmbedEnabled !== appearanceSnapshot.htmlEmbedEnabled ||
                promptAutocompleteEnabled !== appearanceSnapshot.promptAutocompleteEnabled ||
                promptAutocompleteAiEnabled !== appearanceSnapshot.promptAutocompleteAiEnabled;
            if (prefsChanged) {
                await adminServer.client.preferences.patchGlobal({
                    theme,
                    reposSidebarCollapsed,
                    htmlEmbed: { enabled: htmlEmbedEnabled },
                    promptAutocomplete: {
                        enabled: promptAutocompleteEnabled,
                        ai: { enabled: promptAutocompleteAiEnabled },
                    },
                });
            }
            // Save config-backed display values
            const configChanged = taskCardDensity !== appearanceSnapshot.taskCardDensity ||
                historyGrouping !== appearanceSnapshot.historyGrouping ||
                showReportIntent !== appearanceSnapshot.showReportIntent ||
                toolCompactness !== appearanceSnapshot.toolCompactness;
            if (configChanged) {
                await adminServer.client.admin.updateConfig({ taskCardDensity, historyGrouping, showReportIntent, toolCompactness });
            }
            addToast('Settings saved', 'success');
            if (!adminServer.isRemote) invalidateDisplaySettings();
            if (!adminServer.isRemote) invalidateHtmlEmbedPreference();
            setAppearanceSnapshot({
                theme,
                reposSidebarCollapsed,
                htmlEmbedEnabled,
                promptAutocompleteEnabled,
                promptAutocompleteAiEnabled,
                taskCardDensity,
                historyGrouping,
                showReportIntent,
                toolCompactness,
            });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setAppearanceSaving(false);
        }
    }, [adminServer, theme, reposSidebarCollapsed, htmlEmbedEnabled, promptAutocompleteEnabled, promptAutocompleteAiEnabled, taskCardDensity, historyGrouping, showReportIntent, toolCompactness, appearanceSnapshot, addToast]);
    const handleCancelAppearance = useCallback(() => {
        setTheme(appearanceSnapshot.theme as Theme);
        setReposSidebarCollapsed(appearanceSnapshot.reposSidebarCollapsed);
        setHtmlEmbedEnabled(appearanceSnapshot.htmlEmbedEnabled);
        setPromptAutocompleteEnabled(appearanceSnapshot.promptAutocompleteEnabled);
        setPromptAutocompleteAiEnabled(appearanceSnapshot.promptAutocompleteAiEnabled);
        setTaskCardDensity(appearanceSnapshot.taskCardDensity);
        setHistoryGrouping(appearanceSnapshot.historyGrouping);
        setShowReportIntent(appearanceSnapshot.showReportIntent);
        setToolCompactness(appearanceSnapshot.toolCompactness);
    }, [appearanceSnapshot]);

    return {
        theme, setTheme,
        reposSidebarCollapsed, setReposSidebarCollapsed,
        htmlEmbedEnabled, setHtmlEmbedEnabled,
        promptAutocompleteEnabled, setPromptAutocompleteEnabled,
        promptAutocompleteAiEnabled, setPromptAutocompleteAiEnabled,
        taskCardDensity, setTaskCardDensity,
        historyGrouping, setHistoryGrouping,
        showReportIntent, setShowReportIntent,
        toolCompactness, setToolCompactness,
        appearanceDirty, appearanceSaving,
        handleSaveAppearance, handleCancelAppearance,
        hydrateFromConfig, hydrateFromPreferences,
    };
}

export type AdminPreferencesForm = ReturnType<typeof useAdminPreferencesForm>;
