import { describe, expect, it, vi } from 'vitest';
import type { ProcessIndexEntry, ProcessStore } from '@plusplusoneplusplus/forge';
import { createSearchConversationsTool, type SearchConversationsArgs } from '../../../src/server/llm-tools/search-conversations-tool';
import { LLM_TOOL_PARAMETER_SCHEMAS } from '../../../src/server/llm-tools/llm-tool-parameter-schemas';

const invocation = { sessionId: 'session', toolCallId: 'call', toolName: 'search_conversations', arguments: {} };
const entry = (id: string, overrides: Partial<ProcessIndexEntry> = {}): ProcessIndexEntry => ({
    id, workspaceId: 'workspace-a', type: 'chat', title: 'Deployment plan',
    status: 'completed', startTime: '2026-10-01T00:00:00Z', promptPreview: 'Initial prompt', ...overrides,
});

function setup(entries: ProcessIndexEntry[], defaultWorkspace = 'workspace-a') {
    const getProcessSummaries = vi.fn(async (filter) => ({
        entries: entries.slice(filter.offset, filter.offset + filter.limit), total: entries.length,
    }));
    const store = {
        getProcessSummaries,
        getWorkspaces: vi.fn().mockResolvedValue([{ id: 'workspace-a', name: 'Project A' }]),
        getProcess: vi.fn(), getConversationTurns: vi.fn(), searchConversations: vi.fn(),
    };
    const { tool } = createSearchConversationsTool({
        store: store as unknown as ProcessStore, workspaceId: defaultWorkspace, currentProcessId: 'current',
    });
    return { store, tool, search: (args: SearchConversationsArgs) => tool.handler(args, invocation) };
}

describe('search_conversations title lookup', () => {
    it('matches literal displayed titles with server/workspace labels, without reading transcripts', async () => {
        const { search, store } = setup([entry('renamed', { customTitle: 'Release [Plan]' }), entry('other')]);
        const result = await search({ title: '  [pLaN]  ' });
        expect(result).toMatchObject({ mode: 'title', total: 1, ambiguous: false, results: [{
            processId: 'renamed', title: 'Release [Plan]', workspaceId: 'workspace-a',
            workspaceLabel: 'Project A', server: 'local',
        }] });
        expect(store.getProcess).not.toHaveBeenCalled();
        expect(store.getConversationTurns).not.toHaveBeenCalled();
        expect(store.searchConversations).not.toHaveBeenCalled();
        expect((await search({ title: 'Deployment' })) as object).toMatchObject({ total: 1, results: [{ processId: 'other' }] });
    });

    it('finds older matches before paginating and reports ambiguity across pages', async () => {
        const entries = Array.from({ length: 205 }, (_, i) => entry(`other-${i}`, { title: 'Other chat' }));
        entries.push(entry('first'), entry('second'), entry('third'));
        const { search, store } = setup(entries);
        const result = await search({ title: 'plan', limit: 1, offset: 1, since: '2026-10-01', until: '2026-10-16' });
        expect(result).toMatchObject({
            total: 3, ambiguous: true, hasMore: true, results: [{ processId: 'second' }],
            message: 'Multiple chats match. Ask the user which chat to attach.',
        });
        expect(store.getProcessSummaries).toHaveBeenCalledTimes(2);
        expect(store.getProcessSummaries).toHaveBeenLastCalledWith({
            workspaceId: 'workspace-a', type: 'chat', since: new Date('2026-10-01'), until: new Date('2026-10-16'),
            limit: 200, offset: 200,
        });
    });

    it('excludes other workspace identities, archived chats, internal jobs and the invoking chat', async () => {
        const { search } = setup([
            entry('same-id', { workspaceId: 'workspace-b' }), entry('same-id'),
            entry('archived', { archived: true }), entry('internal', { type: 'dream-analyzer' }), entry('current'),
        ]);
        expect(await search({ title: 'plan' })).toMatchObject({ total: 1, results: [{ processId: 'same-id', workspaceId: 'workspace-a' }] });
    });

    it('uses prompt preview for untitled chats and raw workspace identity if its label is missing', async () => {
        const { search } = setup([entry('untitled', { title: undefined, workspaceId: 'workspace-b', promptPreview: 'Find my plan' })]);
        expect(await search({ title: 'plan', workspaceId: 'workspace-b' })).toMatchObject({
            total: 1, results: [{ processId: 'untitled', workspaceId: 'workspace-b', workspaceLabel: 'workspace-b' }],
        });
    });

    it('returns an explicit empty result', async () => {
        const { search } = setup([]);
        expect(await search({ title: 'missing' })).toMatchObject({ total: 0, results: [], ambiguous: false, hasMore: false });
    });

    it('rejects unsupported remote owners without calling a local store', async () => {
        const { search, store } = setup([]);
        expect(await search({ title: 'plan', workspaceId: 'remote:server:workspace-a' })).toMatchObject({ code: 'unavailable' });
        expect(store.getProcessSummaries).not.toHaveBeenCalled();
        expect(store.getWorkspaces).not.toHaveBeenCalled();
    });

    it.each([{ title: ' ' }, { title: 'plan', query: 'plan' }])('rejects invalid title arguments %j', async args => {
        const { search, store } = setup([]);
        expect(await search(args)).toMatchObject({ code: 'invalid' });
        expect(store.getProcessSummaries).not.toHaveBeenCalled();
    });

    it('requires a workspace and reports unavailable metadata support explicitly', async () => {
        const { search } = setup([], '');
        expect(await search({ title: 'plan' })).toMatchObject({ code: 'invalid' });
        const { tool } = createSearchConversationsTool({ store: {} as ProcessStore, workspaceId: 'workspace-a' });
        expect(await tool.handler({ title: 'plan' }, invocation)).toMatchObject({ code: 'unavailable' });
    });

    it('exposes title lookup to scripted and regular callers', () => {
        const { tool } = setup([]);
        expect(tool.parameters).toMatchObject({ properties: { title: { type: 'string' } } });
        expect(LLM_TOOL_PARAMETER_SCHEMAS.search_conversations).toMatchObject({ properties: { title: { type: 'string' } } });
    });
});
