/**
 * Global system prompt — provider parity (AC-04)
 *
 * The admin-configured global system prompt is injected by the coc executor
 * layer into the shared `SendMessageOptions.systemMessage` channel (see
 * `system-message-builder.ts` / `buildGlobalSystemPromptBlock` in the `coc`
 * package). These tests verify the *provider boundary*: that whatever block the
 * executor places in `systemMessage` is delivered to each provider's native
 * system-message channel identically —
 *
 *   - Copilot → `SessionConfig.systemMessage` (verbatim passthrough)
 *   - Codex   → `[System instructions]` prepend on the turn input
 *   - Claude  → `systemPrompt` (claude_code preset append for `mode: 'append'`)
 *
 * The block text is reproduced here as a literal rather than imported so the
 * SDK package test stays free of any dependency on the `coc` package.
 */

import { describe, expect, it, vi } from 'vitest';
import { ClaudeSDKService } from '../../src/claude-sdk-service';
import { CodexSDKService } from '../../src/codex-sdk-service';
import { RequestRunner } from '../../src/request-runner';
import { SessionManager } from '../../src/session-manager';
import type { SystemMessageConfig } from '../../src/types';
import { createMockSession } from '../helpers/mock-sdk';

const DEFAULT_AI_TIMEOUT_MS = 6 * 60 * 60 * 1000;

// The admin-configured prompt text and the labeled block the coc builder wraps
// it in (mirrors `buildGlobalSystemPromptBlock`).
const GLOBAL_PROMPT = 'Always cite sources. Prefer TypeScript over JavaScript.';
const GLOBAL_BLOCK = [
    '<admin-global-system-prompt>',
    GLOBAL_PROMPT,
    '</admin-global-system-prompt>',
].join('\n');

// What the executor's systemMessageBuilder hands to a provider: a mode preamble
// followed by the appended global block, as a single `append` systemMessage.
const MODE_PREAMBLE = '<coc-ask-mode>read-only</coc-ask-mode>';
const GLOBAL_SYSTEM_MESSAGE: SystemMessageConfig = {
    mode: 'append',
    content: `${MODE_PREAMBLE}\n\n${GLOBAL_BLOCK}`,
};

const USER_PROMPT = 'user prompt';

// ---------------------------------------------------------------------------
// Per-provider send helpers — each returns the provider-native object/string
// that carries the system message, so tests can assert what actually reaches
// the SDK.
// ---------------------------------------------------------------------------

/** Copilot: returns the `SessionConfig` passed to `client.createSession`. */
async function sendViaCopilot(systemMessage?: SystemMessageConfig): Promise<any> {
    const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
    const createSession = vi.fn().mockResolvedValue(mockSession);
    const mockClient = {
        createSession,
        resumeSession: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new RequestRunner(
        vi.fn().mockResolvedValue({ available: true, sdkPath: '/fake/sdk' }),
        vi.fn().mockResolvedValue(mockClient),
        new SessionManager(),
        DEFAULT_AI_TIMEOUT_MS,
        3_600_000,
    );

    const result = await runner.send({
        prompt: USER_PROMPT,
        timeoutMs: 5000,
        loadDefaultMcpConfig: false,
        ...(systemMessage ? { systemMessage } : {}),
    });
    expect(result.success).toBe(true);
    return createSession.mock.calls[0][0];
}

function makeCodexMock() {
    const thread = {
        id: 'thread-1',
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started' as const, thread_id: 'thread-1' };
                yield {
                    type: 'item.completed' as const,
                    item: { id: 'item-1', type: 'agent_message', text: 'ok' },
                };
            })(),
        })),
    };
    const client = {
        startThread: vi.fn(() => thread),
        resumeThread: vi.fn(() => thread),
    };
    return { client, thread };
}

/** Codex: returns the turn input string passed to `thread.runStreamed`. */
async function sendViaCodex(systemMessage?: SystemMessageConfig): Promise<string> {
    const svc = new CodexSDKService();
    const { client, thread } = makeCodexMock();
    (svc as unknown as { sdk: unknown }).sdk = client;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    try {
        const result = await svc.sendMessage({
            prompt: USER_PROMPT,
            ...(systemMessage ? { systemMessage } : {}),
        });
        expect(result.success).toBe(true);
        return thread.runStreamed.mock.calls[0][0] as string;
    } finally {
        svc.dispose();
    }
}

async function* makeMessages(messages: object[]): AsyncIterable<object> {
    for (const msg of messages) yield msg;
}

/** Claude: returns the `ClaudeQueryOptions` passed to the SDK `query` fn. */
async function sendViaClaude(systemMessage?: SystemMessageConfig): Promise<any> {
    const svc = new ClaudeSDKService();
    const queryFn = vi.fn().mockReturnValue(
        makeMessages([{ type: 'result', subtype: 'success', result: 'ok' }]),
    );
    (svc as unknown as { queryFn: unknown }).queryFn = queryFn;
    (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

    try {
        const result = await svc.sendMessage({
            prompt: USER_PROMPT,
            ...(systemMessage ? { systemMessage } : {}),
        });
        expect(result.success).toBe(true);
        return queryFn.mock.calls[0][0];
    } finally {
        svc.dispose();
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('global system prompt provider parity (AC-04)', () => {
    it('delivers the same global block to Copilot, Codex, and Claude native channels', async () => {
        const [copilotConfig, codexInput, claudeOptions] = await Promise.all([
            sendViaCopilot(GLOBAL_SYSTEM_MESSAGE),
            sendViaCodex(GLOBAL_SYSTEM_MESSAGE),
            sendViaClaude(GLOBAL_SYSTEM_MESSAGE),
        ]);

        // Each provider exposes the block through its own native field.
        const copilotText: string = copilotConfig.systemMessage.content;
        const claudeText: string = claudeOptions.options.systemPrompt.append;

        for (const delivered of [copilotText, codexInput, claudeText]) {
            expect(delivered).toContain(GLOBAL_BLOCK);
            expect(delivered).toContain(GLOBAL_PROMPT);
        }
    });

    it('Copilot passes the global systemMessage through to SessionConfig.systemMessage verbatim', async () => {
        const sessionConfig = await sendViaCopilot(GLOBAL_SYSTEM_MESSAGE);

        expect(sessionConfig.systemMessage).toEqual(GLOBAL_SYSTEM_MESSAGE);
        expect(sessionConfig.systemMessage.content).toContain(GLOBAL_BLOCK);
    });

    it('Codex prepends the global systemMessage under [System instructions] without dropping the user prompt', async () => {
        const input = await sendViaCodex(GLOBAL_SYSTEM_MESSAGE);

        // Current Codex contract: `[System instructions]:\n<content>\n\n<prompt>`.
        expect(input).toBe(`[System instructions]:\n${GLOBAL_SYSTEM_MESSAGE.content}\n\n${USER_PROMPT}`);
        expect(input).toContain(GLOBAL_BLOCK);
        expect(input.endsWith(USER_PROMPT)).toBe(true);
    });

    it('Claude maps the global systemMessage to the claude_code preset systemPrompt without mutating the prompt', async () => {
        const queryOptions = await sendViaClaude(GLOBAL_SYSTEM_MESSAGE);

        expect(queryOptions.prompt).toBe(USER_PROMPT);
        expect(queryOptions.options.systemPrompt).toEqual({
            type: 'preset',
            preset: 'claude_code',
            append: GLOBAL_SYSTEM_MESSAGE.content,
        });
        expect(queryOptions.options.systemPrompt.append).toContain(GLOBAL_BLOCK);
    });

    it('leaves every provider native system channel inert when no global prompt is configured', async () => {
        const [copilotConfig, codexInput, claudeOptions] = await Promise.all([
            sendViaCopilot(),
            sendViaCodex(),
            sendViaClaude(),
        ]);

        // Copilot: no systemMessage on the session config.
        expect(copilotConfig).not.toHaveProperty('systemMessage');
        // Codex: the turn input is the bare user prompt — no prepend.
        expect(codexInput).toBe(USER_PROMPT);
        // Claude: no systemPrompt option.
        expect(claudeOptions.options).not.toHaveProperty('systemPrompt');
    });

    it('does not introduce a sendFollowUp-style API on any provider adapter', () => {
        // Guards the AC-04 constraint: no provider keep-alive cache or
        // sendFollowUp-style session-reuse API is added for this feature.
        expect((CodexSDKService.prototype as Record<string, unknown>).sendFollowUp).toBeUndefined();
        expect((ClaudeSDKService.prototype as Record<string, unknown>).sendFollowUp).toBeUndefined();
        expect((RequestRunner.prototype as Record<string, unknown>).sendFollowUp).toBeUndefined();
    });
});
