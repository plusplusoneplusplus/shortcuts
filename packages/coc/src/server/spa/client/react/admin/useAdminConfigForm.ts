/**
 * useAdminConfigForm — controller for the "AI & Execution" and "Chat
 * Experience" config cards.
 *
 * Owns the model/parallel/timeout/output form, the chat behaviour toggles
 * (follow-up suggestions, ask-user, report-intent, tool verbosity), per-card
 * dirty/saving state, validation, and the `admin.updateConfig` payloads. Both
 * cards read the same resolved config object, so they hydrate together.
 */
import { useCallback, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { invalidateDisplaySettings } from '../hooks/preferences/useDisplaySettings';

export const VALID_OUTPUT_OPTIONS = ['table', 'json', 'csv', 'markdown'] as const;

export type ToolCompactness = 0 | 1 | 2 | 3;

interface AiExecSnapshot {
    model: string;
    parallel: string;
    timeout: string;
    output: string;
}

interface ChatSnapshot {
    followUpEnabled: boolean;
    followUpCount: string;
    askUserEnabled: boolean;
    showReportIntent: boolean;
    toolCompactness: ToolCompactness;
}

export interface UseAdminConfigFormOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
}

export function useAdminConfigForm({ addToast }: UseAdminConfigFormOptions) {
    // AI & Execution
    const [configForm, setConfigForm] = useState<Record<string, string>>({});
    const [aiExecSnapshot, setAiExecSnapshot] = useState<AiExecSnapshot>({ model: '', parallel: '1', timeout: '', output: 'table' });
    const [aiExecSaving, setAiExecSaving] = useState(false);

    // Chat Experience
    const [showReportIntent, setShowReportIntent] = useState(false);
    const [toolCompactness, setToolCompactness] = useState<ToolCompactness>(3);
    const [chatFollowUpEnabled, setChatFollowUpEnabled] = useState(true);
    const [chatFollowUpCount, setChatFollowUpCount] = useState('3');
    const [chatAskUserEnabled, setChatAskUserEnabled] = useState(false);
    const [chatSnapshot, setChatSnapshot] = useState<ChatSnapshot>({ followUpEnabled: true, followUpCount: '3', askUserEnabled: false, showReportIntent: false, toolCompactness: 3 });
    const [chatSaving, setChatSaving] = useState(false);

    /** Loads both cards from a freshly-fetched resolved config. */
    const hydrate = useCallback((resolved: any) => {
        const form = {
            model: resolved.model ?? '',
            parallel: String(resolved.parallel ?? 1),
            timeout: resolved.timeout != null ? String(resolved.timeout) : '',
            output: resolved.output ?? 'table',
        };
        setConfigForm(form);
        setAiExecSnapshot({ model: form.model, parallel: form.parallel, timeout: form.timeout, output: form.output });

        const sri = resolved.showReportIntent ?? false;
        const tc = (resolved.toolCompactness ?? 1) as ToolCompactness;
        const fue = resolved.chat?.followUpSuggestions?.enabled ?? true;
        const fuc = String(resolved.chat?.followUpSuggestions?.count ?? 3);
        const aue = resolved.chat?.askUser?.enabled ?? false;
        setShowReportIntent(sri);
        setToolCompactness(tc);
        setChatFollowUpEnabled(fue);
        setChatFollowUpCount(fuc);
        setChatAskUserEnabled(aue);
        setChatSnapshot({ followUpEnabled: fue, followUpCount: fuc, askUserEnabled: aue, showReportIntent: sri, toolCompactness: tc });
    }, []);

    const aiExecDirty = configForm.model !== aiExecSnapshot.model ||
        configForm.parallel !== aiExecSnapshot.parallel ||
        configForm.timeout !== aiExecSnapshot.timeout ||
        configForm.output !== aiExecSnapshot.output;

    const chatDirty = chatFollowUpEnabled !== chatSnapshot.followUpEnabled ||
        chatFollowUpCount !== chatSnapshot.followUpCount ||
        chatAskUserEnabled !== chatSnapshot.askUserEnabled ||
        showReportIntent !== chatSnapshot.showReportIntent ||
        toolCompactness !== chatSnapshot.toolCompactness;

    const handleSaveAiExec = useCallback(async () => {
        const errors: string[] = [];
        const parallel = Number(configForm.parallel);
        if (isNaN(parallel) || parallel < 1) errors.push('Parallelism must be at least 1');
        const timeoutStr = configForm.timeout.trim();
        let timeoutValue: number | null = null;
        if (timeoutStr !== '') {
            const timeout = Number(timeoutStr);
            if (isNaN(timeout) || !Number.isInteger(timeout) || timeout < 1) {
                errors.push('Timeout must be a positive integer');
            } else {
                timeoutValue = timeout;
            }
        }
        if (!(VALID_OUTPUT_OPTIONS as readonly string[]).includes(configForm.output)) {
            errors.push(`Output must be one of: ${VALID_OUTPUT_OPTIONS.join(', ')}`);
        }
        if (errors.length) { addToast(errors.join('; '), 'error'); return; }
        setAiExecSaving(true);
        try {
            const payload: Record<string, unknown> = { parallel, output: configForm.output };
            if (configForm.model?.trim()) payload.model = configForm.model.trim();
            payload.timeout = timeoutValue;
            await getSpaCocClient().admin.updateConfig(payload);
            addToast('Settings saved', 'success');
            setAiExecSnapshot({ model: configForm.model, parallel: configForm.parallel, timeout: configForm.timeout, output: configForm.output });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setAiExecSaving(false);
        }
    }, [configForm, addToast]);

    const handleCancelAiExec = useCallback(() => {
        setConfigForm({ ...aiExecSnapshot });
    }, [aiExecSnapshot]);

    const handleSaveChat = useCallback(async () => {
        const errors: string[] = [];
        const count = Number(chatFollowUpCount);
        if (isNaN(count) || !Number.isInteger(count) || count < 1 || count > 5) {
            errors.push('Follow-up count must be an integer between 1 and 5');
        }
        if (errors.length) { addToast(errors.join('; '), 'error'); return; }
        setChatSaving(true);
        try {
            const payload: Record<string, unknown> = {
                'chat.followUpSuggestions.enabled': chatFollowUpEnabled,
                'chat.followUpSuggestions.count': count,
                'chat.askUser.enabled': chatAskUserEnabled,
                showReportIntent,
                toolCompactness,
            };
            await getSpaCocClient().admin.updateConfig(payload);
            addToast('Settings saved', 'success');
            invalidateDisplaySettings();
            setChatSnapshot({ followUpEnabled: chatFollowUpEnabled, followUpCount: chatFollowUpCount, askUserEnabled: chatAskUserEnabled, showReportIntent, toolCompactness });
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setChatSaving(false);
        }
    }, [chatFollowUpEnabled, chatFollowUpCount, chatAskUserEnabled, showReportIntent, toolCompactness, addToast]);

    const handleCancelChat = useCallback(() => {
        setChatFollowUpEnabled(chatSnapshot.followUpEnabled);
        setChatFollowUpCount(chatSnapshot.followUpCount);
        setChatAskUserEnabled(chatSnapshot.askUserEnabled);
        setShowReportIntent(chatSnapshot.showReportIntent);
        setToolCompactness(chatSnapshot.toolCompactness);
    }, [chatSnapshot]);

    return {
        // AI & Execution
        configForm, setConfigForm,
        aiExecDirty, aiExecSaving,
        handleSaveAiExec, handleCancelAiExec,
        // Chat Experience
        showReportIntent, setShowReportIntent,
        toolCompactness, setToolCompactness,
        chatFollowUpEnabled, setChatFollowUpEnabled,
        chatFollowUpCount, setChatFollowUpCount,
        chatAskUserEnabled, setChatAskUserEnabled,
        chatDirty, chatSaving,
        handleSaveChat, handleCancelChat,
        // Shared
        hydrate,
    };
}

export type AdminConfigForm = ReturnType<typeof useAdminConfigForm>;
