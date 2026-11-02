import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import type { McpOAuthPromptData } from './useChatSSE';

/** Request IDs are retired for this mounted owner only; new IDs remain eligible. */
export function useChatMcpOAuthPrompts(
    ownerKey: string,
    client: Pick<CocClient, 'request'>,
    workspaceId: string | undefined,
    processId: string | null,
    available = true,
) {
    const memoryByOwner = useRef(new Map<string, { retired: Set<string>; failed: Set<string> }>());
    const scope = useMemo(() => {
        let memory = memoryByOwner.current.get(ownerKey);
        if (!memory) {
            memory = { retired: new Set<string>(), failed: new Set<string>() };
            memoryByOwner.current.set(ownerKey, memory);
        }
        return { prompts: [] as McpOAuthPromptData[], ...memory };
    }, [ownerKey]);
    const current = useRef<typeof scope | null>(scope);
    current.current = scope;
    const [, render] = useState(0);
    useEffect(() => {
        current.current = scope;
        return () => { if (current.current === scope) current.current = null; };
    }, [scope]);
    const refresh = useCallback(() => {
        if (current.current === scope) render(n => n + 1);
    }, [scope]);
    const request = useCallback<CocClient['request']>((path, options) => {
        if (!available || !workspaceId || !processId) return Promise.reject(new Error('Chat owner is unavailable'));
        const id = decodeURIComponent(path.split('/')[3] ?? '');
        if (options?.method !== 'DELETE' && (current.current !== scope || scope.retired.has(id))) {
            return Promise.reject(new Error('Authentication request is no longer active'));
        }
        const query = new URLSearchParams({ workspaceId, processId });
        return client.request(`${path}?${query}`, { ...options, timeoutMs: 15_000 });
    }, [client, available, workspaceId, processId, scope]);
    const add = useCallback((prompt: McpOAuthPromptData) => {
        if (current.current !== scope || scope.retired.has(prompt.requestId)) return;
        const index = scope.prompts.findIndex(p => p.requestId === prompt.requestId);
        if (index < 0) scope.prompts = [...scope.prompts, prompt];
        else scope.prompts = scope.prompts.map((p, i) => i === index ? prompt : p);
        refresh();
    }, [scope, refresh]);
    const remove = useCallback((id: string) => {
        if (current.current !== scope) return;
        scope.retired.add(id);
        scope.prompts = scope.prompts.filter(p => p.requestId !== id);
        refresh();
    }, [scope, refresh]);
    const completed = useCallback((prompt: McpOAuthPromptData) => remove(prompt.requestId), [remove]);
    const cancel = useCallback(async (id: string) => {
        try {
            await request(`/mcp-oauth/pending/${encodeURIComponent(id)}`, { method: 'DELETE' });
            scope.failed.delete(id);
        } catch (error) {
            // An expired/already removed flow is also dismissed.
            if ((error as { status?: number }).status !== 404) scope.failed.add(id);
        }
        // A pending cancellation can settle after navigation away and back.
        if (current.current?.failed === scope.failed) render(n => n + 1);
    }, [request, scope]);
    const dismiss = useCallback((ids: string[]) => {
        if (current.current !== scope) return;
        const shown = ids.filter(id => scope.prompts.some(p => p.requestId === id));
        // Retire synchronously before any I/O or a repeated SSE notification.
        shown.forEach(remove);
        void Promise.all(shown.map(cancel));
    }, [scope, remove, cancel]);
    return {
        prompts: scope.prompts,
        add, remove, completed, dismiss, request,
        cancellationFailed: scope.failed.size > 0,
        retryDismissal: () => {
            if (current.current === scope) void Promise.all([...scope.failed].map(cancel));
        },
    };
}
