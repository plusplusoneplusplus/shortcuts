import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    PromptAutocompleteService,
    validateAiCompletion,
} from '../../src/server/processes/prompt-autocomplete-service';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-autocomplete-service-'));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeStore() {
    return {
        getBestPromptCompletion: vi.fn(),
        getPromptAutocompleteContext: vi.fn(),
    };
}

async function writePrefs(promptAutocomplete: unknown): Promise<void> {
    await fs.writeFile(
        path.join(tmpDir, 'preferences.json'),
        JSON.stringify({ global: { promptAutocomplete } }),
    );
}

function makeContext() {
    return {
        exactPrefixMatches: [{
            text: 'fix the queue autocomplete tests',
            source: 'initial' as const,
            workspaceId: 'ws1',
            processId: 'p1',
            timestamp: '2024-06-01T12:00:00.000Z',
            prefixMatch: true,
        }],
        recentWorkspacePrompts: [],
        recentProcessTurns: [],
        historyFingerprint: '1:2024-06-01T12:00:00.000Z:1',
    };
}

describe('PromptAutocompleteService', () => {
    it('returns deterministic history fallback when AI is disabled', async () => {
        await writePrefs({ enabled: true, ai: { enabled: false } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue({ completion: 'queue test', source: 'initial' });
        const aiService = { sendMessage: vi.fn() };

        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });
        const result = await service.getCompletion({ prefix: 'fix the ', workspaceId: 'ws1' });

        expect(result).toEqual({ completion: 'queue test', source: 'history', historySource: 'initial' });
        expect(aiService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns null when global prompt autocomplete is disabled', async () => {
        await writePrefs({ enabled: false, ai: { enabled: true } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue({ completion: 'queue test', source: 'initial' });

        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir });
        const result = await service.getCompletion({ prefix: 'fix the ', workspaceId: 'ws1' });

        expect(result).toEqual({ completion: null });
        expect(store.getBestPromptCompletion).not.toHaveBeenCalled();
    });

    it('returns null when promptAutocomplete preference is absent (disabled by default)', async () => {
        // No writePrefs() call — preferences file is missing entirely.
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue({ completion: 'queue test', source: 'initial' });

        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir });
        const result = await service.getCompletion({ prefix: 'fix the ', workspaceId: 'ws1' });

        expect(result).toEqual({ completion: null });
        expect(store.getBestPromptCompletion).not.toHaveBeenCalled();
    });

    it('returns valid AI suffix when AI is enabled and grounded context exists', async () => {
        await writePrefs({ enabled: true, ai: { enabled: true } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue({ completion: 'history suffix', source: 'initial' });
        store.getPromptAutocompleteContext.mockReturnValue(makeContext());
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'queue autocomplete tests' }),
            }),
        };

        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });
        const result = await service.getCompletion({ prefix: 'fix the ', workspaceId: 'ws1', processId: 'p1', surface: 'follow-up' });

        expect(result).toEqual({ completion: 'queue autocomplete tests', source: 'ai' });
        expect(aiService.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-4.1',
            timeoutMs: 20000,
            loadDefaultMcpConfig: false,
        }));
        expect(aiService.sendMessage.mock.calls[0][0].prompt).toContain('Prefix: "fix the "');
    });

    it('falls back to history when AI output is invalid', async () => {
        await writePrefs({ enabled: true, ai: { enabled: true } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue({ completion: 'history suffix', source: 'follow-up' });
        store.getPromptAutocompleteContext.mockReturnValue(makeContext());
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: 'Sure, I can help with that.',
            }),
        };

        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });
        const result = await service.getCompletion({ prefix: 'fix the ', workspaceId: 'ws1' });

        expect(result).toEqual({ completion: 'history suffix', source: 'history', historySource: 'follow-up' });
    });

    it('does not include workspace history context when no workspaceId and global history is disabled', async () => {
        await writePrefs({ enabled: true, ai: { enabled: true, includeGlobalHistory: false } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue({ completion: 'history suffix', source: 'initial' });
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'queue test' }),
            }),
        };

        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });
        const result = await service.getCompletion({ prefix: 'fix the ' });

        // AI is still called even without workspaceId (workspace-scoped privacy preserved by skipping history).
        expect(result).toEqual({ completion: 'queue test', source: 'ai' });
        expect(store.getPromptAutocompleteContext).not.toHaveBeenCalled();
        expect(aiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('caches positive AI completions for repeated requests', async () => {
        await writePrefs({ enabled: true, ai: { enabled: true } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue(null);
        store.getPromptAutocompleteContext.mockReturnValue(makeContext());
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'queue autocomplete tests' }),
            }),
        };
        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });

        await service.getCompletion({ prefix: 'fix the ', workspaceId: 'ws1' });
        await service.getCompletion({ prefix: 'fix the ', workspaceId: 'ws1' });

        expect(aiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('uses AI from the prefix even when history context is empty', async () => {
        await writePrefs({ enabled: true, ai: { enabled: true } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue(null);
        store.getPromptAutocompleteContext.mockReturnValue({
            exactPrefixMatches: [],
            recentWorkspacePrompts: [],
            recentProcessTurns: [],
            historyFingerprint: '0::0',
        });
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'e' }),
            }),
        };
        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });

        const result = await service.getCompletion({ prefix: 'Hello, please rebas', workspaceId: 'ws1' });

        expect(result).toEqual({ completion: 'e', source: 'ai' });
        expect(aiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('treats mode=ai as an explicit AI opt-in when AI preferences are absent', async () => {
        await writePrefs({ enabled: true });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue(null);
        store.getPromptAutocompleteContext.mockReturnValue({
            exactPrefixMatches: [],
            recentWorkspacePrompts: [],
            recentProcessTurns: [],
            historyFingerprint: '0::0',
        });
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'e' }),
            }),
        };
        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });

        const result = await service.getCompletion({ prefix: 'Hello, please rebas', workspaceId: 'ws1', mode: 'ai' });

        expect(result).toEqual({ completion: 'e', source: 'ai' });
        expect(aiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('honors the promptAutocomplete.ai.model preference override', async () => {
        await writePrefs({ enabled: true, ai: { enabled: true, model: 'claude-haiku-4.5' } });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue(null);
        store.getPromptAutocompleteContext.mockReturnValue({
            exactPrefixMatches: [],
            recentWorkspacePrompts: [],
            recentProcessTurns: [],
            historyFingerprint: '0::0',
        });
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'e' }),
            }),
        };
        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });

        await service.getCompletion({ prefix: 'Hello, please rebas', workspaceId: 'ws1' });

        expect(aiService.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            model: 'claude-haiku-4.5',
        }));
    });

    it('uses AI from the prefix when the store has no history-context method', async () => {
        await writePrefs({ enabled: true });
        const store = {
            getBestPromptCompletion: vi.fn().mockReturnValue(null),
        };
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'e' }),
            }),
        };
        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });

        const result = await service.getCompletion({ prefix: 'Hello, please rebas', workspaceId: 'ws1', mode: 'ai' });

        expect(result).toEqual({ completion: 'e', source: 'ai' });
        expect(aiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('fires AI in hybrid mode when enabled and no ai config is set', async () => {
        // Master toggle on; `ai` section absent so DEFAULT_AI_CONFIG applies.
        await writePrefs({ enabled: true });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue(null);
        store.getPromptAutocompleteContext.mockReturnValue({
            exactPrefixMatches: [],
            recentWorkspacePrompts: [],
            recentProcessTurns: [],
            historyFingerprint: '0::0',
        });
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'e>' }),
            }),
        };
        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });

        const result = await service.getCompletion({
            prefix: '<Hello, please rebas>',
            workspaceId: '<workspace-id>',
            processId: '<process-id>',
            surface: 'queue',
            mode: 'hybrid',
        });

        expect(result).toEqual({ completion: 'e>', source: 'ai' });
        expect(aiService.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('fires AI in hybrid mode when enabled even without workspaceId', async () => {
        await writePrefs({ enabled: true });
        const store = makeStore();
        store.getBestPromptCompletion.mockReturnValue(null);
        const aiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: JSON.stringify({ completion: 'e' }),
            }),
        };
        const service = new PromptAutocompleteService({ store: store as any, dataDir: tmpDir, aiService: aiService as any });

        const result = await service.getCompletion({ prefix: 'Hello, please rebas', mode: 'hybrid' });

        expect(result).toEqual({ completion: 'e', source: 'ai' });
        expect(aiService.sendMessage).toHaveBeenCalledTimes(1);
        expect(store.getPromptAutocompleteContext).not.toHaveBeenCalled();
    });
});

describe('validateAiCompletion', () => {
    it('accepts a JSON suffix', () => {
        expect(validateAiCompletion(JSON.stringify({ completion: 'queue test' }), 'fix the ')).toBe('queue test');
    });

    it('strips an accidental repeated prefix from a full-prompt completion', () => {
        expect(validateAiCompletion(
            JSON.stringify({ completion: 'Hello, please rebase' }),
            'Hello, please rebas',
        )).toBe('e');
    });

    it('rejects malformed JSON, full answers, empty repeated prefixes, and fences', () => {
        expect(validateAiCompletion('queue test', 'fix the ')).toBeNull();
        expect(validateAiCompletion(JSON.stringify({ completion: 'Sure, I can help' }), 'fix the ')).toBeNull();
        expect(validateAiCompletion(JSON.stringify({ completion: 'fix the ' }), 'fix the ')).toBeNull();
        expect(validateAiCompletion(JSON.stringify({ completion: '```json' }), 'fix the ')).toBeNull();
    });
});
