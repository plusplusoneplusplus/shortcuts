/**
 * @vitest-environment jsdom
 *
 * AC-07 DoD #3/#4 (subtask 8d, composer half) — the SHARED initial composer (the
 * one the Notes empty state renders) resolves its owning clone from `workspaceId`
 * and threads that clone's remote baseUrl into EVERY provider/model/effort/prompt
 * read at once, and loads skills + repo preferences from the routed clone client.
 *
 * The per-hook routing (given a baseUrl, hook X reads REMOTE and never LOCAL, and
 * two servers never share a cache entry) is already proven by
 * providerHooks-clone-routing / promptHooks-clone-routing. This file is the
 * end-to-end proof of the OTHER half: that InitialChatComposer actually computes
 * `useResolveCloneBaseUrl()(workspaceId)` and hands it to all seven hooks, and
 * uses `useCocClient(workspaceId)` (not the page-origin client) for skills/prefs.
 *
 * To pin that wiring precisely and without the flake of driving lazy autocomplete
 * / prompt-history fetches, the seven hooks are mocked as spies that record the
 * baseUrl they were called with; cloneRouting + the clone registry stay REAL, so
 * `workspaceId → baseUrl` resolution and `useCocClient` routing are exercised for
 * real against per-baseUrl fake clients.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

// ── Hoisted capture buckets + fake clients ─────────────────────────────────────
const {
    captured,
    localClient,
    remotes,
    getCocClientForSpy,
    mockSlashCommands,
    mockModelCommand,
    mockDraftStore,
    mockAutocomplete,
    mockHistory,
} = vi.hoisted(() => ({
    captured: {
        agentProviders: [] as (string | undefined)[],
        models: [] as (string | undefined)[],
        reasoning: [] as (string | undefined)[],
        effortTiers: [] as (string | undefined)[],
        defaultModel: [] as (string | undefined)[],
        autocomplete: [] as (string | undefined)[],
        history: [] as (string | undefined)[],
    },
    localClient: makeClient('local'),
    remotes: new Map<string, ReturnType<typeof makeClient>>(),
    getCocClientForSpy: { fn: null as any },
    mockSlashCommands: {
        menuVisible: false, menuFilter: '', filteredSkills: [], highlightIndex: 0,
        handleInputChange: () => {}, handleKeyDown: () => false, selectSkill: () => {},
        parseAndExtract: () => ({ skills: [], prompt: '' }), dismissMenu: () => {},
    },
    mockModelCommand: {
        modelMenuVisible: false, modelFilter: '', filteredModels: [], modelHighlightIndex: 0,
        modelOverride: null as string | null, setModelOverride: () => {}, handleModelSelect: () => {},
        showModelMenu: () => {}, dismissModelMenu: () => {}, handleModelKeyDown: () => false, setModelFilter: () => {},
    },
    mockDraftStore: {
        getDraft: () => null, setDraft: () => {}, clearDraft: () => {},
        newChatDraftKey: (wsId?: string) => `new-chat:${wsId ?? '__global__'}`,
    },
    mockAutocomplete: { completion: '', accept: () => '', dismiss: () => {} },
    mockHistory: { handleKeyDown: () => false, reset: () => {} },
}));

// A per-baseUrl fake CocClient recording the skills/preferences reads that route
// through useCocClient. Declared as a hoisted function so the vi.hoisted block
// above can build LOCAL + the remote registry.
function makeClient(label: string) {
    return {
        label,
        skills: { listAllWorkspace: vi.fn(async () => ({ merged: [] })) },
        preferences: {
            getRepo: vi.fn(async () => ({})),
            patchRepo: vi.fn(async () => ({})),
            patchGlobal: vi.fn(async () => ({})),
            getLlmToolsConfig: vi.fn(async () => ({ tools: [], disabledLlmTools: [], conversationRetrievalAvailable: false })),
        },
        queue: { enqueue: vi.fn(async () => ({ task: { id: 't' } })) },
    };
}

// ── cocClient: LOCAL origin + per-baseUrl REMOTE registry (cloneRouting stays real) ──
vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => localClient,
    getCocClientFor: (baseUrl?: string) => getCocClientForSpy.fn(baseUrl),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) =>
        err instanceof Error ? err.message : fallback,
}));

// ── The seven routing hooks → spies that record the baseUrl the composer passes ──
vi.mock('../../../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: (baseUrl?: string) => {
        captured.agentProviders.push(baseUrl);
        return { providers: [{ id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true }], loading: false };
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: (_provider?: string, baseUrl?: string) => {
        captured.models.push(baseUrl);
        return { models: [], loading: false, error: null, reload: () => {} };
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/hooks/useProviderReasoningEfforts', () => ({
    useProviderReasoningEfforts: (_provider: unknown, baseUrl?: string) => {
        captured.reasoning.push(baseUrl);
        return {};
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers', () => ({
    useProviderEffortTiers: (_provider: unknown, baseUrl?: string) => {
        captured.effortTiers.push(baseUrl);
        return { tiers: {}, loading: false };
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: (_ws: unknown, _mode: unknown, _models: unknown, _provider: unknown, baseUrl?: string) => {
        captured.defaultModel.push(baseUrl);
        return { effectiveModel: undefined, effectiveModelName: undefined };
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/hooks/usePromptAutocomplete', () => ({
    usePromptAutocomplete: (opts: { baseUrl?: string }) => {
        captured.autocomplete.push(opts.baseUrl);
        return mockAutocomplete;
    },
}));
vi.mock('../../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled', () => ({
    usePromptAutocompleteEnabled: () => true,
}));
vi.mock('../../../../../../src/server/spa/client/react/hooks/useChatPromptHistory', () => ({
    useChatPromptHistory: (opts: { baseUrl?: string }) => {
        captured.history.push(opts.baseUrl);
        return mockHistory;
    },
}));

// ── Contexts, config flags, and heavy leaves (mirrors NewChatArea.test.tsx) ─────
vi.mock('../../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: () => {} }),
}));
vi.mock('../../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [{ id: 'ws-1', rootPath: '/repo' }], onboardingProgress: { hasUsedChat: true } }, dispatch: () => {} }),
}));
vi.mock('../../../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [{ workspace: { id: 'ws-1', name: 'repo', rootPath: '/repo' } }], loading: false, fetchRepos: () => {}, unseenCounts: {} }),
}));
vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
    isRalphEnabled: () => false,
    isRalphMultiAgentGrillEnabled: () => false,
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isLoopsEnabled: () => false,
    getDefaultProvider: () => 'copilot' as const,
    getConfiguredDefaultProvider: () => 'copilot' as const,
    isAutoAgentProviderRoutingEnabled: () => false,
    isEffortLevelsEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
    isGitWorktreeExecutionEnabled: () => false,
}));
vi.mock('../../../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => mockSlashCommands,
}));
vi.mock('../../../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
    useModelCommand: () => mockModelCommand,
    selectPickableModels: (models: unknown[]) => models,
}));
vi.mock('../../../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: (...a: any[]) => mockDraftStore.getDraft(...a),
    setDraft: (...a: any[]) => mockDraftStore.setDraft(...a),
    clearDraft: (...a: any[]) => mockDraftStore.clearDraft(...a),
    newChatDraftKey: (...a: any[]) => mockDraftStore.newChatDraftKey(...a),
}));
vi.mock('../../../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [], getMetaSkillItems: () => [], mergeSkillsWithMeta: (s: any[]) => s,
}));
vi.mock('../../../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));
vi.mock('../../../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            R.useImperativeHandle(ref, () => ({ getValue: () => '', setValue: () => {}, focus: () => {} }), []);
            return R.createElement('input', { 'data-testid': props['data-testid'] });
        }),
    };
});

import { InitialChatComposer } from '../../../../../../src/server/spa/client/react/features/chat/NewChatArea';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../../../src/server/spa/client/react/repos/cloneRegistry';
import { _clearConfigCache } from '../../../../../../src/server/spa/client/react/api/staticConfigCache';

const REMOTE_URL = 'http://remote-a:4000';

function remoteFor(baseUrl: string) {
    let c = remotes.get(baseUrl);
    if (!c) { c = makeClient(`remote:${baseUrl}`); remotes.set(baseUrl, c); }
    return c;
}

function resetCaptured() {
    for (const k of Object.keys(captured) as (keyof typeof captured)[]) captured[k].length = 0;
}

async function mountComposer(workspaceId: string) {
    let utils!: ReturnType<typeof render>;
    await act(async () => {
        utils = render(
            React.createElement(InitialChatComposer, {
                workspaceId,
                onSubmit: vi.fn().mockResolvedValue(null),
                testIdPrefix: 'note-chat',
                settingsLayout: 'compact',
                enableRalphDirectGoal: false,
            }),
        );
        await Promise.resolve();
    });
    return utils;
}

const HOOK_KEYS: (keyof typeof captured)[] = [
    'agentProviders', 'models', 'reasoning', 'effortTiers', 'defaultModel', 'autocomplete', 'history',
];

beforeEach(() => {
    resetCloneRegistryForTests();
    _clearConfigCache();
    resetCaptured();
    remotes.clear();
    localClient.skills.listAllWorkspace.mockClear();
    localClient.preferences.getRepo.mockClear();
    getCocClientForSpy.fn = vi.fn((baseUrl?: string) => {
        if (!baseUrl) throw new Error('getCocClientFor called without a baseUrl');
        return remoteFor(baseUrl);
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
    registerCloneBaseUrls([{ workspaceId: 'ws-1', baseUrl: REMOTE_URL }]);
});

afterEach(() => {
    resetCloneRegistryForTests();
    vi.restoreAllMocks();
});

describe('InitialChatComposer — clone routing (AC-07 DoD #3/#4)', () => {
    it('threads the remote clone baseUrl into every provider/model/effort/prompt hook', async () => {
        await mountComposer('ws-1');

        for (const key of HOOK_KEYS) {
            expect(captured[key].length, `hook ${key} was called`).toBeGreaterThan(0);
            expect(
                captured[key].every(v => v === REMOTE_URL),
                `hook ${key} always received the remote baseUrl (got ${JSON.stringify(captured[key])})`,
            ).toBe(true);
        }
    });

    it('loads skills and repo preferences from the routed remote clone, never the local client', async () => {
        await mountComposer('ws-1');
        const remote = remoteFor(REMOTE_URL);

        expect(remote.skills.listAllWorkspace).toHaveBeenCalledWith('ws-1');
        expect(remote.preferences.getRepo).toHaveBeenCalledWith('ws-1');
        expect(localClient.skills.listAllWorkspace).not.toHaveBeenCalled();
        expect(localClient.preferences.getRepo).not.toHaveBeenCalled();
    });

    it('keeps an unregistered (local) workspace on the origin client and passes no baseUrl to the hooks', async () => {
        await mountComposer('ws-local');

        for (const key of HOOK_KEYS) {
            expect(captured[key].length, `hook ${key} was called`).toBeGreaterThan(0);
            expect(
                captured[key].every(v => v === undefined),
                `hook ${key} received no baseUrl for a local clone (got ${JSON.stringify(captured[key])})`,
            ).toBe(true);
        }
        // Skills + preferences came from the local origin client, and the remote
        // resolver was never consulted for a local clone.
        expect(localClient.skills.listAllWorkspace).toHaveBeenCalledWith('ws-local');
        expect(localClient.preferences.getRepo).toHaveBeenCalledWith('ws-local');
        expect(getCocClientForSpy.fn).not.toHaveBeenCalled();
        expect(remotes.size).toBe(0);
    });
});
