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
import { useCallback, useState } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';

export interface UseServerRuntimeOptions {
    addToast: (message: string, type: 'success' | 'error') => void;
    /** Reloads the admin config after a successful display-name save. */
    reloadConfig: () => Promise<void>;
}

export function useServerRuntime({ addToast, reloadConfig }: UseServerRuntimeOptions) {
    const [serverName, setServerName] = useState('');
    const [restarting, setRestarting] = useState(false);
    const [restartStatus, setRestartStatus] = useState<string>('');

    const handleSaveServerName = useCallback(async () => {
        const trimmed = serverName.trim();
        try {
            await getSpaCocClient().admin.updateConfig({ 'serve.serverName': trimmed || null });
            setServerName(trimmed);
            addToast('Server name saved — takes effect on next page reload', 'success');
            await reloadConfig();
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Could not save server name'), 'error');
        }
    }, [serverName, addToast, reloadConfig]);

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
        serverName, setServerName,
        handleSaveServerName,
        restarting, restartStatus, handleRestart,
    };
}

export type ServerRuntime = ReturnType<typeof useServerRuntime>;
