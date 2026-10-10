/**
 * useServerRuntime — controller for server display-name and lifecycle
 * (rebuild + restart).
 *
 * Restart is shared between two call sites — the always-visible sidebar restart
 * button and the Server tab's "Rebuild & Restart" row — so its state lives here
 * rather than inside `ServerRuntimePanel`. Restart is a two-part design (server
 * exits 75, an external supervisor re-forks it); the desktop-shell guard that
 * hides the controls stays at the call sites.
 */
import { useCallback, useRef, useState } from 'react';
import type { AdminConfigResponse } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';

export interface UseServerRuntimeOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
    /** Updates config metadata without rehydrating unrelated draft cards. */
    onSaved: (config: AdminConfigResponse) => void;
}

export function useServerRuntime({ addToast, onSaved }: UseServerRuntimeOptions) {
    const [serverName, setServerNameState] = useState('');
    const [serverNameSnapshot, setServerNameSnapshot] = useState<string | null>(null);
    const [serverNameSaving, setServerNameSaving] = useState(false);
    const nameRef = useRef<{ draft: string; saved: string | null; saving: boolean }>({ draft: '', saved: null, saving: false });
    const [restarting, setRestarting] = useState(false);
    const [restartStatus, setRestartStatus] = useState<string>('');

    const setServerName = useCallback((value: string) => {
        nameRef.current.draft = value;
        setServerNameState(value);
    }, []);

    const hydrateServerName = useCallback((value: string) => {
        const state = nameRef.current;
        if (state.saving) return;
        if (state.saved === null || state.draft.trim() === state.saved) setServerName(value);
        state.saved = value.trim();
        setServerNameSnapshot(state.saved);
    }, [setServerName]);

    const handleSaveServerName = useCallback(async () => {
        const state = nameRef.current;
        const draft = state.draft;
        const trimmed = draft.trim();
        if (state.saving || state.saved === null || trimmed === state.saved) return;
        // All entry points share admission before React can render saving state.
        state.saving = true;
        setServerNameSaving(true);
        try {
            const config = await getSpaCocClient().admin.updateConfig({ 'serve.serverName': trimmed || null });
            state.saved = trimmed;
            setServerNameSnapshot(trimmed);
            if (state.draft === draft) setServerName(trimmed);
            onSaved(config);
            addToast('Server name saved — takes effect on next page reload', 'success');
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Could not save server name'), 'error');
        } finally {
            state.saving = false;
            setServerNameSaving(false);
        }
    }, [setServerName, addToast, onSaved]);

    const handleRestart = useCallback(async () => {
        setRestarting(true);
        setRestartStatus('Sending restart request…');
        try {
            await getSpaCocClient().admin.restart();
            setRestartStatus('Server is restarting. Waiting for it to come back…');
            addToast('Restart initiated — rebuilding…', 'success');
            // Poll until the server comes back, then reload the page
            const poll = () => {
                setTimeout(async () => {
                    try {
                        await getSpaCocClient().admin.getDataStats(undefined, { signal: AbortSignal.timeout(2000) });
                        setRestartStatus('Server is back!');
                        window.location.reload();
                        return;
                    } catch { /* server still down */ }
                    poll();
                }, 3000);
            };
            poll();
        } catch (err: unknown) {
            setRestartStatus('Restart failed: ' + getSpaCocClientErrorMessage(err, 'Network error'));
            setRestarting(false);
        }
    }, [addToast]);

    return {
        serverName, setServerName, hydrateServerName,
        serverNameDirty: serverNameSnapshot !== null && serverName.trim() !== serverNameSnapshot,
        serverNameSaving,
        handleSaveServerName,
        restarting, restartStatus, handleRestart,
    };
}

export type ServerRuntime = ReturnType<typeof useServerRuntime>;
