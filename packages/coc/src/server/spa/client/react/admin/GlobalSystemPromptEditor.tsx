/**
 * GlobalSystemPromptEditor — admin editor for `chat.globalSystemPrompt`.
 *
 * Loads the resolved value from `admin.getConfig()` and persists it via
 * `admin.updateConfig({ 'chat.globalSystemPrompt': ... })`. The prompt is
 * injected into every user-facing agent session across Copilot, Codex, and
 * Claude through the shared systemMessage path; it supplements — but does not
 * override — CoC runtime constraints. Saving an empty prompt clears the value.
 */

import { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../ui';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import { SettingsCard } from './SettingsCard';

interface GlobalSystemPromptEditorProps {
    onError: (msg: string) => void;
}

export function GlobalSystemPromptEditor({ onError }: GlobalSystemPromptEditorProps) {
    const [value, setValue] = useState('');
    const [saved, setSaved] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getSpaCocClient().admin.getConfig();
            const current = data.resolved?.chat?.globalSystemPrompt ?? '';
            setValue(current);
            setSaved(current);
        } catch (err: unknown) {
            onError(getSpaCocClientErrorMessage(err, 'Failed to load global system prompt'));
        } finally {
            setLoading(false);
        }
    }, [onError]);

    useEffect(() => {
        void load();
    }, [load]);

    const dirty = value !== saved;

    const handleSave = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            // Empty/whitespace-only input clears the stored value.
            const next = value.trim() ? value : null;
            await getSpaCocClient().admin.updateConfig({ 'chat.globalSystemPrompt': next });
            const applied = next ?? '';
            setValue(applied);
            setSaved(applied);
        } catch (err: unknown) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to save global system prompt'));
        } finally {
            setSaving(false);
        }
    }, [value]);

    const handleCancel = useCallback(() => {
        setValue(saved);
        setError(null);
    }, [saved]);

    const handleClear = useCallback(async () => {
        setSaving(true);
        setError(null);
        try {
            await getSpaCocClient().admin.updateConfig({ 'chat.globalSystemPrompt': null });
            setValue('');
            setSaved('');
        } catch (err: unknown) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to clear global system prompt'));
        } finally {
            setSaving(false);
        }
    }, []);

    if (loading) {
        return (
            <section className="ar-card" data-testid="global-system-prompt-loading">
                <div className="ar-card-body flex items-center gap-2 text-sm text-[#848484]">
                    <Spinner size="sm" /> Loading global prompt…
                </div>
            </section>
        );
    }

    return (
        <SettingsCard
            title="Global System Prompt"
            description="Injected into every user-facing agent session across Copilot, Codex, and Claude. It supplements — but does not override — CoC runtime constraints (read-only mode, tool policy, permissions). Leave empty to disable."
            badge="Global"
            dirty={dirty}
            saving={saving}
            onSave={handleSave}
            onCancel={handleCancel}
            data-testid="global-system-prompt"
        >
            <textarea
                className="ar-textarea w-full"
                rows={8}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="e.g. Always cite file paths as clickable links and keep replies concise."
                disabled={saving}
                data-testid="global-system-prompt-input"
                style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
            />
            {error && (
                <div className="text-xs text-red-500 mt-2" data-testid="global-system-prompt-error">{error}</div>
            )}
            <div className="flex mt-2">
                <button
                    type="button"
                    className="ar-btn ar-btn-ghost ar-btn-sm"
                    onClick={handleClear}
                    disabled={saving || (!saved && !value)}
                    data-testid="global-system-prompt-clear"
                    title="Clear the stored global system prompt"
                >
                    Clear
                </button>
            </div>
        </SettingsCard>
    );
}
