import { useEffect, useRef } from 'react';
import type { BotControlPresentation } from '@plusplusoneplusplus/coc-client';
import { readBotControl } from '../../../utils/botControl';

export interface BotControlUpdate {
    processId: string;
    workspaceId?: string;
    control?: BotControlPresentation;
}

/** Observe the existing owning-server socket, including conversations absent from the local index. */
export function useBotControlUpdates(
    baseUrl: string | undefined,
    workspaceId: string | undefined,
    onUpdate: (update: BotControlUpdate) => void,
): void {
    const callback = useRef(onUpdate);
    callback.current = onUpdate;
    useEffect(() => {
        const eventName = baseUrl ? 'coc-remote-ws-message' : 'coc-local-ws-message';
        const handle = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (baseUrl && detail?.baseUrl !== baseUrl) return;
            const message = baseUrl ? detail?.message : detail;
            if (message?.type !== 'process-added' && message?.type !== 'process-updated') return;
            const process = message.process;
            if (typeof process?.id !== 'string'
                || (workspaceId && process.workspaceId !== workspaceId)) return;
            callback.current({
                processId: process.id,
                workspaceId: process.workspaceId,
                control: readBotControl(process.botControl),
            });
        };
        window.addEventListener(eventName, handle);
        return () => window.removeEventListener(eventName, handle);
    }, [baseUrl, workspaceId]);
}
