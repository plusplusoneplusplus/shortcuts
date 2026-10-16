import type { DashboardChatQuery, DashboardChatSearchResult } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor } from '../../api/cocClient';
import { getDashboardTopology } from './topology';
import { loadDashboardChatCache, saveDashboardChatCache } from './chat-cache';

const pageSize = 200;
const unavailable = () => new Error('Dashboard chat discovery unavailable');
const isText = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 512;

/** Read only the exact visible destination, never a registry fallback or transcript. */
export async function searchDashboardChats(query: DashboardChatQuery, signal: AbortSignal): Promise<DashboardChatSearchResult> {
    if (!query || !query.target || !isText(query.target.serverIdentity) || !isText(query.target.workspaceId)
        || !isText(query.title) || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100
        || !Number.isSafeInteger(query.offset) || query.offset < 0) throw unavailable();
    const target = { serverIdentity: query.target.serverIdentity, workspaceId: query.target.workspaceId };
    const needle = query.title.trim().toLowerCase();
    const { limit, offset } = query;
    const snapshot = getDashboardTopology();
    const routes = snapshot.routes.filter(({ row }) =>
        row.serverIdentity === target.serverIdentity && row.workspaceId === target.workspaceId);
    const route = routes.find(({ row }) => row.online) ?? routes[0];
    if (!route) throw unavailable();
    const current = () => {
        signal.throwIfAborted();
        if (getDashboardTopology() !== snapshot) throw unavailable();
    };
    current();
    const result = (inventory: DashboardChatSearchResult['conversations'], verification: 'verified' | 'unverified') => {
        current();
        const matches = inventory.filter(({ title }) => title.toLowerCase().includes(needle));
        return { target, serverLabel: route.row.serverLabel, workspaceLabel: route.row.workspaceLabel,
            serverKind: route.row.serverKind, verification, total: matches.length,
            conversations: matches.slice(offset, offset + limit) };
    };
    if (!route.row.online) {
        const inventory = loadDashboardChatCache(target);
        if (!inventory) throw unavailable();
        return result(inventory, 'unverified');
    }
    if (route.row.serverKind !== 'local' && !route.baseUrl) throw unavailable();
    const client = getCocClientFor(route.baseUrl);
    const verify = async () => {
        current();
        const health = await client.health.get({ signal });
        current();
        if (health.serverIdentity !== target.serverIdentity) throw unavailable();
    };
    const conversations: DashboardChatSearchResult['conversations'] = [];
    const ids = new Set<string>();
    let inventoryTotal: number | undefined;
    for (let scanOffset = 0; ; scanOffset += pageSize) {
        await verify();
        const page = await client.processes.summaries({
            workspace: target.workspaceId, type: 'chat', archived: false, limit: pageSize, offset: scanOffset,
        }, { signal });
        current();
        if (!page || !Array.isArray(page.summaries) || !Number.isSafeInteger(page.total) || page.total < 0
            || (inventoryTotal !== undefined && inventoryTotal !== page.total)
            || page.limit !== pageSize || page.offset !== scanOffset
            || page.summaries.length !== Math.min(pageSize, Math.max(0, page.total - scanOffset))) throw unavailable();
        inventoryTotal = page.total;
        for (const entry of page.summaries) {
            if (!entry || !isText(entry.id) || ids.has(entry.id)
                || typeof entry.workspaceId !== 'string' || typeof entry.type !== 'string'
                || (entry.archived !== undefined && typeof entry.archived !== 'boolean')
                || (entry.customTitle !== undefined && typeof entry.customTitle !== 'string')
                || (entry.title !== undefined && typeof entry.title !== 'string')
                || (entry.promptPreview !== undefined && typeof entry.promptPreview !== 'string')) throw unavailable();
            ids.add(entry.id);
            const title = entry.customTitle || entry.title || entry.promptPreview || '';
            if (entry.workspaceId !== target.workspaceId || entry.type !== 'chat' || entry.archived) continue;
            if (title.length > 4096) throw unavailable();
            conversations.push({ processId: entry.id, title });
        }
        if (scanOffset + page.summaries.length >= page.total) break;
    }
    // The last response must not be attributed to an installation that replaced its endpoint.
    await verify();
    saveDashboardChatCache(target, conversations);
    return result(conversations, 'verified');
}
