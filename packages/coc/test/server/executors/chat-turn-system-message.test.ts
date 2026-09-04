/**
 * The system message is what the model actually reads, so block *order* is
 * load-bearing and is asserted here rather than left to each call site.
 *
 * Also pins first-turn / follow-up parity: given the same inputs, both paths
 * must produce byte-identical output. Before this builder existed, the two
 * paths each maintained their own copy of the chain and could drift.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AutoFolderContext } from '@plusplusoneplusplus/forge';
import type { MemoryV2Addon } from '../../../src/server/executors/memory-v2-addon';
import { GLOBAL_SYSTEM_PROMPT_TAG } from '../../../src/server/executors/system-message-builder';
import {
    buildChatTurnSystemMessage,
    buildCodexAskUserDiscoveryBlock,
    type ChatTurnSystemMessageInput,
} from '../../../src/server/executors/chat-turn-system-message';

// ============================================================================
// Fixtures
// ============================================================================

function memoryAddon(suffix?: string): MemoryV2Addon {
    return {
        systemMessageSuffix: suffix,
        tools: [],
        suffix: '',
        excludedBuiltinTools: [],
        dispose: () => {},
    } as unknown as MemoryV2Addon;
}

function autoFolder(): AutoFolderContext {
    return { tasksRoot: '/data/ws/notes/Plans', existingFolders: ['refactoring'] } as AutoFolderContext;
}

function input(overrides: Partial<ChatTurnSystemMessageInput> = {}): ChatTurnSystemMessageInput {
    return {
        // No working directory: repo-instruction loading hits the filesystem and
        // is covered by system-message-builder's own tests.
        workingDirectory: undefined,
        provider: 'copilot',
        forEachGeneration: null,
        mapReduceGeneration: null,
        memoryV2: memoryAddon(),
        toolGuidance: '',
        ...overrides,
    };
}

// ============================================================================
// Block order
// ============================================================================

describe('buildChatTurnSystemMessage', () => {
    it('returns undefined when no block applies', async () => {
        // OpenCode has no source-location guidance, so with nothing else set
        // there is genuinely nothing to send.
        const result = await buildChatTurnSystemMessage(input({ provider: 'opencode' }));

        expect(result).toBeUndefined();
    });

    it('orders the global prompt first, then memory, then tool guidance', async () => {
        const result = await buildChatTurnSystemMessage(input({
            globalSystemPrompt: 'OPERATOR-RULE',
            memoryV2: memoryAddon('MEMORY-BLOCK'),
            toolGuidance: 'TOOL-GUIDANCE',
        }));

        const content = result!.content;
        const globalIdx = content.indexOf(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
        const memoryIdx = content.indexOf('MEMORY-BLOCK');
        const toolIdx = content.indexOf('TOOL-GUIDANCE');

        expect(globalIdx).toBe(0);
        expect(memoryIdx).toBeGreaterThan(globalIdx);
        expect(toolIdx).toBeGreaterThan(memoryIdx);
    });

    it('carries no read-only block — the mode directive rides the user turn', async () => {
        const result = await buildChatTurnSystemMessage(input({ toolGuidance: 'TOOL-GUIDANCE' }));

        expect(result!.content).not.toContain('coc-read-only-mode');
    });

    it('places the auto-folder block after tool guidance and the note block last', async () => {
        const result = await buildChatTurnSystemMessage(input({
            toolGuidance: 'TOOL-GUIDANCE',
            autoFolderContext: autoFolder(),
            notePath: 'Notes/a.md',
        }));

        const content = result!.content;
        expect(content.indexOf('notes/Plans')).toBeGreaterThan(content.indexOf('TOOL-GUIDANCE'));
        expect(content.indexOf('Notes/a.md')).toBeGreaterThan(content.indexOf('notes/Plans'));
    });

    it('suppresses the auto-folder block when the caller passes undefined (grilling / non-ask follow-up)', async () => {
        const withFolder = await buildChatTurnSystemMessage(input({ autoFolderContext: autoFolder() }));
        const withoutFolder = await buildChatTurnSystemMessage(input({ autoFolderContext: undefined }));

        expect(withFolder!.content).toContain('notes/Plans');
        expect(withoutFolder!.content).not.toContain('notes/Plans');
    });

    it('omits the global prompt block when the admin setting is unset or blank', async () => {
        const unset = await buildChatTurnSystemMessage(input({ globalSystemPrompt: undefined }));
        const blank = await buildChatTurnSystemMessage(input({ globalSystemPrompt: '   ' }));

        expect(unset!.content).not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        expect(blank!.content).not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
    });
});

// ============================================================================
// First-turn / follow-up parity
// ============================================================================

describe('first-turn and follow-up parity', () => {
    it('produces byte-identical output for the same inputs on both paths', async () => {
        // Mirrors what ChatBaseExecutor.buildStandardModeOptions and
        // FollowUpExecutor.executeFollowUp each pass in for an ask-mode turn.
        const shared = input({
            provider: 'claude',
            globalSystemPrompt: 'OPERATOR-RULE',
            memoryV2: memoryAddon('MEMORY-BLOCK'),
            toolGuidance: 'TOOL-GUIDANCE',
            autoFolderContext: autoFolder(),
            notePath: 'Notes/a.md',
        });

        const firstTurn = await buildChatTurnSystemMessage(shared);
        const followUp = await buildChatTurnSystemMessage({ ...shared });

        expect(followUp!.content).toBe(firstTurn!.content);
        expect(followUp!.mode).toBe('append');
    });

    it('emits source-location guidance for Copilot and Claude but not Codex or OpenCode', async () => {
        const marker = '<citing_rule>';

        // Tool guidance keeps the message non-empty for the providers that
        // contribute no block of their own.
        for (const provider of ['copilot', 'claude'] as const) {
            const result = await buildChatTurnSystemMessage(input({ provider, toolGuidance: 'TOOL-GUIDANCE' }));
            expect(result!.content).toContain(marker);
        }
        for (const provider of ['codex', 'opencode'] as const) {
            const result = await buildChatTurnSystemMessage(input({ provider, toolGuidance: 'TOOL-GUIDANCE' }));
            expect(result!.content).not.toContain(marker);
        }
    });

});

// ============================================================================
// Codex `ask_user` discovery
// ============================================================================

describe('Codex ask_user discovery block', () => {
    const MARKER = '<codex-ask-user-discovery>';

    it('teaches Codex the deferred code-mode name when ask_user is in the turn bundle', async () => {
        const result = await buildChatTurnSystemMessage(input({
            provider: 'codex',
            toolGuidance: 'TOOL-GUIDANCE',
            askUserAvailable: true,
        }));

        const content = result!.content;
        expect(content).toContain(MARKER);
        expect(content).toContain('mcp__coc_llm_tools__ask_user');
        expect(content).toContain('ALL_TOOLS');
        expect(content).toContain('functions.exec');
        // The block must distinguish CoC's tool from the unrelated Codex built-in,
        // which is what the model previously confused it with.
        expect(content).toContain('request_user_input');
    });

    it('omits the block for every non-Codex provider even when ask_user is available', async () => {
        for (const provider of ['copilot', 'claude', 'opencode'] as const) {
            const result = await buildChatTurnSystemMessage(input({
                provider,
                toolGuidance: 'TOOL-GUIDANCE',
                askUserAvailable: true,
            }));
            expect(result!.content).not.toContain(MARKER);
        }
    });

    it('omits the block for Codex when ask_user was filtered out of the bundle', async () => {
        // Workspace LLM-tool preferences (or a context exclusion) dropped the
        // tool: the prompt must not claim it is available.
        for (const askUserAvailable of [false, undefined]) {
            const result = await buildChatTurnSystemMessage(input({
                provider: 'codex',
                toolGuidance: 'TOOL-GUIDANCE',
                askUserAvailable,
            }));
            expect(result!.content).not.toContain(MARKER);
        }
    });

    it('lands with the tool-guidance section, before the auto-folder block', async () => {
        const result = await buildChatTurnSystemMessage(input({
            provider: 'codex',
            toolGuidance: 'TOOL-GUIDANCE',
            askUserAvailable: true,
            autoFolderContext: autoFolder(),
        }));

        const content = result!.content;
        expect(content.indexOf(MARKER)).toBeGreaterThan(content.indexOf('TOOL-GUIDANCE'));
        expect(content.indexOf(MARKER)).toBeLessThan(content.indexOf('notes/Plans'));
    });

    it('exposes the same block from the helper regardless of caller', () => {
        expect(buildCodexAskUserDiscoveryBlock('codex', true)).toContain(MARKER);
        expect(buildCodexAskUserDiscoveryBlock('codex', false)).toBeUndefined();
        expect(buildCodexAskUserDiscoveryBlock('claude', true)).toBeUndefined();
        expect(buildCodexAskUserDiscoveryBlock(undefined, true)).toBeUndefined();
    });

    it('sends byte-identical discovery text on ask and autopilot turns', async () => {
        // The input type carries no `mode`, so the only way the two first-turn
        // builders can differ is by passing different `askUserAvailable` — both
        // register ask_user unconditionally, so both get the same bytes.
        const shared = input({
            provider: 'codex',
            toolGuidance: 'TOOL-GUIDANCE',
            askUserAvailable: true,
        });

        const askTurn = await buildChatTurnSystemMessage(shared);
        const autopilotTurn = await buildChatTurnSystemMessage({ ...shared });

        expect(askTurn!.content).toBe(autopilotTurn!.content);
    });
});

// ============================================================================
// Prefix invariance — the durable guard against re-adding a mode branch
// ============================================================================

describe('mode invariance', () => {
    it('loads only the shared instructions.md, never the mode-specific file', async () => {
        // A repo carrying both mode files: whichever mode the turn runs in, the
        // system message must be the same bytes, or a mid-chat mode toggle
        // invalidates the whole conversation's prefix cache.
        const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mode-invariance-'));
        const instructionDir = path.join(repoDir, '.github', 'coc');
        fs.mkdirSync(instructionDir, { recursive: true });
        fs.writeFileSync(path.join(instructionDir, 'instructions.md'), 'SHARED-INSTRUCTIONS');
        fs.writeFileSync(path.join(instructionDir, 'instructions-ask.md'), 'ASK-ONLY-INSTRUCTIONS');
        fs.writeFileSync(path.join(instructionDir, 'instructions-autopilot.md'), 'AUTOPILOT-ONLY-INSTRUCTIONS');

        try {
            const shared = input({
                workingDirectory: repoDir,
                provider: 'claude',
                globalSystemPrompt: 'OPERATOR-RULE',
                toolGuidance: 'TOOL-GUIDANCE',
                autoFolderContext: autoFolder(),
            });

            // `ChatTurnSystemMessageInput` has no `mode` field at all — that is
            // the invariant. Both executors can only pass these same inputs.
            const askTurn = await buildChatTurnSystemMessage(shared);
            const autopilotTurn = await buildChatTurnSystemMessage({ ...shared });

            expect(askTurn!.content).toBe(autopilotTurn!.content);
            expect(askTurn!.content).toContain('SHARED-INSTRUCTIONS');
            expect(askTurn!.content).not.toContain('ASK-ONLY-INSTRUCTIONS');
            expect(askTurn!.content).not.toContain('AUTOPILOT-ONLY-INSTRUCTIONS');
        } finally {
            fs.rmSync(repoDir, { recursive: true, force: true });
        }
    });
});
