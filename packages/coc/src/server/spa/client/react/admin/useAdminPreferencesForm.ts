/**
 * useAdminPreferencesForm — controller for the "Appearance & Navigation" card.
 *
 * Owns the global-preference values (theme, sidebar, HTML embed,
 * prompt autocomplete) plus the two config-backed display values
 * (taskCardDensity, historyGrouping). The card hydrates from two sources — the
 * resolved admin config and the global preferences endpoint — so it exposes
 * two hydrate helpers that each patch the shared dirty snapshot.
 */
import { useCallback, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { invalidateDisplaySettings } from '../hooks/preferences/useDisplaySettings';
import { invalidateHtmlEmbedPreference } from '../hooks/preferences/useHtmlEmbedPreference';

export type Theme = 'light' | 'dark' | 'auto';
export type TaskCardDensity = 'compact' | 'dense';

interface AppearanceSnapshot {
    theme: string;
    reposSidebarCollapsed: boolean;
    htmlEmbedEnabled: boolean;
    promptAutocompleteEnabled: boolean;
    promptAutocompleteAiEnabled: boolean;
    taskCardDensity: TaskCardDensity;
    historyGrouping: boolean;
}

export interface UseAdminPreferencesFormOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
}

export function useAdminPreferencesForm({ addToast }: UseAdminPreferencesFormOptions) {
    const [theme, setTheme] = useState<Theme>('auto');
    const [reposSidebarCollapsed, setReposSidebarCollapsed] = useState(false);
    const [htmlEmbedEnabled, setHtmlEmbedEnabled] = useState(true);
    const [promptAutocompleteEnabled, setPromptAutocompleteEnabled] = useState(false);
    const [promptAutocompleteAiEnabled, setPromptAutocompleteAiEnabled] = useState(false);
    const [taskCardDensity, setTaskCardDensity] = useState<TaskCardDensity>('dense');
    const [historyGrouping, setHistoryGrouping] = useState(true);
    const [appearanceSaving, setAppearanceSaving] = useState(false);
    const [appearanceSnapshot, setAppearanceSnapshot] = useState<AppearanceSnapshot>({
        theme: 'auto',
        reposSidebarCollapsed: false,
        htmlEmbedEnabled: true,
        promptAutocompleteEnabled: false,
        promptAutocompleteAiEnabled: false,
        taskCardDensity: 'compact',
        historyGrouping: true,
    });

    /** Loads the config-backed values (taskCardDensity, historyGrouping). */
    const hydrateFromConfig = useCallback((resolved: any) => {
        const tcd = (resolved.taskCardDensity === 'dense' ? 'dense' : 'compact') as TaskCardDensity;
        const hg = resolved.historyGrouping ?? true;
        setTaskCardDensity(tcd);
        setHistoryGrouping(hg);
        setAppearanceSnapshot(prev => ({ ...prev, taskCardDensity: tcd, historyGrouping: hg }));
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
        historyGrouping !== appearanceSnapshot.historyGrouping;

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
                await getSpaCocClient().preferences.patchGlobal({
                    theme,
                    reposSidebarCollapsed,
                    htmlEmbed: { enabled: htmlEmbedEnabled },
                    promptAutocomplete: {
                        enabled: promptAutocompleteEnabled,
                        ai: { enabled: promptAutocompleteAiEnabled },
                    },
                });
            }
            // Save config (taskCardDensity, historyGrouping)
            const configChanged = taskCardDensity !== appearanceSnapshot.taskCardDensity || historyGrouping !== appearanceSnapshot.historyGrouping;
            if (configChanged) {
                await getSpaCocClient().admin.updateConfig({ taskCardDensity, historyGrouping });
            }
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            invalidateHtmlEmbedPreference();
            setAppearanceSnapshot({
                theme,
                reposSidebarCollapsed,
                htmlEmbedEnabled,
                promptAutocompleteEnabled,
                promptAutocompleteAiEnabled,
                taskCardDensity,
                historyGrouping,
            });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setAppearanceSaving(false);
        }
    }, [theme, reposSidebarCollapsed, htmlEmbedEnabled, promptAutocompleteEnabled, promptAutocompleteAiEnabled, taskCardDensity, historyGrouping, appearanceSnapshot, addToast]);
    const handleCancelAppearance = useCallback(() => {
        setTheme(appearanceSnapshot.theme as Theme);
        setReposSidebarCollapsed(appearanceSnapshot.reposSidebarCollapsed);
        setHtmlEmbedEnabled(appearanceSnapshot.htmlEmbedEnabled);
        setPromptAutocompleteEnabled(appearanceSnapshot.promptAutocompleteEnabled);
        setPromptAutocompleteAiEnabled(appearanceSnapshot.promptAutocompleteAiEnabled);
        setTaskCardDensity(appearanceSnapshot.taskCardDensity);
        setHistoryGrouping(appearanceSnapshot.historyGrouping);
    }, [appearanceSnapshot]);

    return {
        theme, setTheme,
        reposSidebarCollapsed, setReposSidebarCollapsed,
        htmlEmbedEnabled, setHtmlEmbedEnabled,
        promptAutocompleteEnabled, setPromptAutocompleteEnabled,
        promptAutocompleteAiEnabled, setPromptAutocompleteAiEnabled,
        taskCardDensity, setTaskCardDensity,
        historyGrouping, setHistoryGrouping,
        appearanceDirty, appearanceSaving,
        handleSaveAppearance, handleCancelAppearance,
        hydrateFromConfig, hydrateFromPreferences,
    };
}

export type AdminPreferencesForm = ReturnType<typeof useAdminPreferencesForm>;
