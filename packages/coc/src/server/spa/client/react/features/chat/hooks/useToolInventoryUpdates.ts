import { useEffect, useState } from 'react';

/** Invalidate lazy inventory reads using the existing exact-owner socket, never its descriptors. */
export function useToolInventoryUpdates(
    baseUrl: string | undefined,
    workspaceId: string | undefined,
    processId: string | undefined,
): number {
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        if (!workspaceId || !processId) return;
        const messageEvent = baseUrl ? 'coc-remote-ws-message' : 'coc-local-ws-message';
        const connectEvent = baseUrl ? 'coc-remote-ws-connect' : 'coc-local-ws-connect';
        const invalidate = () => setRevision(value => value + 1);
        const handleMessage = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (baseUrl && detail?.baseUrl !== baseUrl) return;
            const message = baseUrl ? detail?.message : detail;
            if (message?.type !== 'tool-inventory-changed'
                || message.workspaceId !== workspaceId || message.processId !== processId
                || typeof message.turnId !== 'string' || !message.turnId
                || (message.state !== 'pending' && message.state !== 'captured')) return;
            invalidate();
        };
        const handleConnect = (event: Event) => {
            if (baseUrl && (event as CustomEvent).detail?.baseUrl !== baseUrl) return;
            invalidate();
        };
        window.addEventListener(messageEvent, handleMessage);
        window.addEventListener(connectEvent, handleConnect);
        return () => {
            window.removeEventListener(messageEvent, handleMessage);
            window.removeEventListener(connectEvent, handleConnect);
        };
    }, [baseUrl, workspaceId, processId]);
    return revision;
}
