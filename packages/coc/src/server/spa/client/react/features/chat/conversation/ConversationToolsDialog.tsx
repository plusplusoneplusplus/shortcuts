import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { CocClient, ConversationToolDescriptor, ConversationToolInventoryResponse, ConversationToolSource } from '@plusplusoneplusplus/coc-client';
import { Dialog } from '../../../ui/Dialog';

export interface ConversationToolsDialogProps {
    open: boolean;
    onClose: () => void;
    /** The conversation's exact owner client; inspection never resolves a fallback. */
    client: Pick<CocClient, 'processes'>;
    workspaceId: string;
    processId: string;
    /** Change when the owning conversation starts or finishes a turn. */
    refreshKey?: string | number;
    returnFocusRef?: RefObject<HTMLElement | null>;
}

const SOURCE_LABELS: Record<ConversationToolSource, string> = { builtin: 'Built-in', coc: 'CoC', mcp: 'MCP' };
const SURFACE = 'rounded border border-[#e0e0e0] dark:border-[#3c3c3c]';

function Inventory({ response, search }: { response: ConversationToolInventoryResponse; search: string }) {
    if (response.state === 'unavailable') return <p>Inventory unavailable</p>;
    const { turn } = response;
    const snapshot = response.state === 'captured' ? response.snapshot : undefined;
    const groups = new Map<string, { label: string; tools: ConversationToolDescriptor[] }>();
    // Keep the source groups separate even when an MCP server is named "CoC".
    groups.set('builtin', { label: 'Built-in', tools: [] });
    groups.set('coc', { label: 'CoC', tools: [] });
    for (const tool of snapshot?.tools ?? []) {
        const key = tool.source === 'mcp' ? `mcp:${tool.serverName ?? ''}` : tool.source;
        if (!groups.has(key)) groups.set(key, { label: tool.serverName ? `MCP · ${tool.serverName}` : 'MCP · Server unavailable', tools: [] });
        groups.get(key)!.tools.push(tool);
    }
    const query = search.trim().toLocaleLowerCase();
    let matches = 0;
    const renderedGroups = [...groups.entries()].map(([key, group]) => {
        const tools = group.tools.filter(tool => [tool.name, tool.description, tool.serverName, group.label]
            .some(value => value?.toLocaleLowerCase().includes(query)));
        matches += tools.length;
        if (query && tools.length === 0) return null;
        return <section key={key} className="space-y-2" aria-label={group.label}>
            <h3 className="font-semibold">{group.label} <span className="font-normal text-[#848484]">({query ? `${tools.length} / ` : ''}{group.tools.length})</span></h3>
            {tools.map((tool, index) => <details key={`${tool.name}:${index}`} className={`${SURFACE} p-2`}>
                <summary className="cursor-pointer break-all font-mono text-xs">{tool.name}</summary>
                <div className="mt-2 space-y-2">
                    <p className="whitespace-pre-wrap break-words">{tool.description ?? 'Description unavailable'}</p>
                    <h4 className="text-xs font-semibold">Input schema</h4>
                    {tool.inputSchema === undefined ? <p>Input schema unavailable</p> :
                        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-[#f5f5f5] dark:bg-[#1e1e1e] p-2 text-xs font-mono">{JSON.stringify(tool.inputSchema, null, 2)}</pre>}
                </div>
            </details>)}
        </section>;
    });
    return <div className="space-y-4">
        <p className="text-xs text-[#848484]">Latest started turn · {turn.provider} · Started {new Date(turn.startedAt).toLocaleString()}
            {snapshot && <> · Captured {new Date(snapshot.capturedAt).toLocaleString()}</>}</p>
        {!snapshot ? <p role="status">Inventory pending — the latest turn is initializing.</p> : <>
            <div className="space-y-1 text-xs" aria-label="Inventory completeness">
                {snapshot.categories.map(category => <p key={category.source}>
                    {SOURCE_LABELS[category.source]}: {category.status}{category.reason ? ` — ${category.reason}` : ''}
                </p>)}
                {snapshot.truncated && <p role="status">Inventory truncated — some tools or details were omitted.</p>}
            </div>
            {snapshot.categories.every(category => category.status === 'unavailable') && <p>Inventory unavailable</p>}
            {query && matches === 0 && <p>No matching tools.</p>}
            {renderedGroups}
        </>}
    </div>;
}

export function ConversationToolsDialog({ open, onClose, client, workspaceId, processId, refreshKey, returnFocusRef }: ConversationToolsDialogProps) {
    const [search, setSearch] = useState('');
    const scope = useMemo(() => ({ client, workspaceId, processId, refreshKey, open }), [client, workspaceId, processId, refreshKey, open]);
    const [result, setResult] = useState<{ scope: typeof scope; response?: ConversationToolInventoryResponse; error?: string }>();

    useEffect(() => {
        if (!open) return;
        setSearch('');
        const controller = new AbortController();
        let retry: ReturnType<typeof setTimeout> | undefined;
        const load = async () => {
            try {
                const response = await client.processes.getToolInventory(processId, { workspace: workspaceId }, { signal: controller.signal });
                if (controller.signal.aborted) return;
                setResult({ scope, response });
                // Pending is bounded lazy polling while this reader is open, never provider discovery.
                if (response.state === 'pending') retry = setTimeout(() => { void load(); }, 3000);
            } catch {
                if (!controller.signal.aborted) setResult({ scope, error: 'Could not load tool inventory.' });
            }
        };
        void load();
        return () => { controller.abort(); clearTimeout(retry); };
    }, [scope, client, workspaceId, processId, open]);

    const current = result?.scope === scope ? result : undefined;
    return <Dialog open={open} onClose={onClose} title="Tools" className="max-w-[760px]" trapFocus returnFocusRef={returnFocusRef}>
        <div className="space-y-4">
            <p className="text-xs text-[#848484]">Advertised callable tools for the latest started turn. Listed tools may still require approval. This inventory is read-only.</p>
            <input type="search" aria-label="Search tools" placeholder="Search tools" data-dialog-initial-focus
                value={search} onChange={event => setSearch(event.target.value)}
                className={`w-full ${SURFACE} bg-white dark:bg-[#1e1e1e] p-2 text-sm`} />
            {current?.error ? <p role="alert">{current.error}</p> : current?.response ?
                <Inventory response={current.response} search={search} /> : <p role="status">Loading tool inventory…</p>}
        </div>
    </Dialog>;
}
