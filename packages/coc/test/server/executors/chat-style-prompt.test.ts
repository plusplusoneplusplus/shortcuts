import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CHAT_STYLES } from '@plusplusoneplusplus/coc-client';
import { SqliteProcessStore, type AIProcess, type ConversationTurn } from '@plusplusoneplusplus/forge';

import {
  buildChatStyleBlock,
  prependChatStyleBlock,
  recordedChatStyle,
  buildChatStyleContext,
  shouldInjectChatStyle,
  setChatStylePromptOverridesProvider,
  persistChatStyleOnUserTurn,
} from '../../../src/server/executors/chat-style-prompt';
import { ProcessMessageDeliveryService } from '../../../src/server/processes/process-message-delivery-service';
import type { QueueExecutorBridge } from '../../../src/server/queue/queue-executor-bridge';
import { CHAT_STYLE_FOCUS_LINES } from '../../../src/config/chat-style-prompts';

describe('buildChatStyleBlock', () => {
  it('builds the human block verbatim', () => {
    expect(buildChatStyleBlock('human')).toBe(
      [
        '<chat-style>',
        'Selected style: Human.',
        'Write like a helpful coworker in a normal conversation. Keep the flow natural and let the wording carry the answer instead of structure.',
        '</chat-style>',
      ].join('\n')
    );
  });

  it('builds the direct block verbatim', () => {
    expect(buildChatStyleBlock('direct')).toBe(
      [
        '<chat-style>',
        'Selected style: Direct.',
        'Lead with the answer or action, then only what the user needs to act on it. Short sentences, plain words, 80% like ASD-STE100. Avoid defensive language, self-protective disclaimers, unnecessary caveats, and repetitive qualifications.',
        '</chat-style>',
      ].join('\n')
    );
  });

  it('builds the terse block verbatim', () => {
    expect(buildChatStyleBlock('terse')).toBe(
      [
        '<chat-style>',
        'Selected style: Terse.',
        'Use the fewest words that fully answer the request. Lead with the answer. Default to 1–3 short sentences. Omit preamble, repetition, background, examples, caveats, and next steps unless essential or requested. Sentence fragments are fine. Preserve critical warnings and exact technical details.',
        '</chat-style>',
      ].join('\n')
    );
  });

  it('builds the structured block verbatim', () => {
    expect(buildChatStyleBlock('structured')).toBe(
      [
        '<chat-style>',
        'Selected style: Structured.',
        'Make the answer easy to scan: outcome, key points, decisions, risks, and next steps. Only organize this way when the answer benefits from it, and never pad a one-line answer into a template. Do not invent owners, dates, decisions, risks, or certainty the context does not support.',
        '</chat-style>',
      ].join('\n')
    );
  });

  it('is exactly four lines for every real style', () => {
    for (const style of ['human', 'direct', 'terse', 'structured']) {
      const block = buildChatStyleBlock(style);
      expect(block).toBeDefined();
      const lines = (block as string).split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe('<chat-style>');
      expect(lines[1]).toMatch(/^Selected style: [A-Z][a-z]+\.$/);
      expect(lines[3]).toBe('</chat-style>');
    }
  });

  it('returns undefined for default and unknown values', () => {
    expect(buildChatStyleBlock('default')).toBeUndefined();
    expect(buildChatStyleBlock('casual')).toBeUndefined();
    expect(buildChatStyleBlock('analytical')).toBeUndefined();
    expect(buildChatStyleBlock(undefined)).toBeUndefined();
    expect(buildChatStyleBlock(null)).toBeUndefined();
    expect(buildChatStyleBlock(42)).toBeUndefined();
  });
});

describe('style context invalidation', () => {
  const block = buildChatStyleBlock('direct')!;
  function process(): AIProcess {
    return {
      id: 'style', type: 'chat', status: 'completed', startTime: new Date(), promptPreview: '',
      sdkSessionId: 'session',
      metadata: { chatStyle: 'direct', chatStyleContext: {
        ...buildChatStyleContext('direct', block, 0), injectedAt: '2026-01-02T00:00:00Z',
      } },
      conversationTurns: [{ role: 'user', content: `${block}\n\nhello`, turnIndex: 0,
        timestamp: new Date('2026-01-01T00:00:00Z'), timeline: [] }],
    };
  }
  it('ignores compaction older than actual injection, even for a pre-compaction accepted turn', () => {
    const proc = process();
    proc.metadata!.compaction = { state: 'completed', completedAt: '2026-01-01T12:00:00Z' };
    expect(shouldInjectChatStyle('direct', block, proc, true)).toBe(false);
  });
  it('restores context after rewind removes the recorded turn', () => {
    const proc = process();
    proc.conversationTurns = [];
    expect(shouldInjectChatStyle('direct', block, proc, true)).toBe(true);
  });
  it('does not trust an invalid execution marker or a replaced user turn', () => {
    const proc = process();
    proc.metadata!.chatStyleContext = { style: 'direct', block };
    expect(shouldInjectChatStyle('direct', block, proc, true)).toBe(true);
    const replaced = process();
    replaced.conversationTurns![0].content = 'replacement';
    expect(shouldInjectChatStyle('direct', block, replaced, true)).toBe(true);
  });
  it('never emits default, even without a session or after compaction', () => {
    expect(shouldInjectChatStyle('default', undefined, undefined, false)).toBe(false);
  });
});

describe('prependChatStyleBlock', () => {
  it('prepends the block, a blank line, then the untouched user text', () => {
    expect(prependChatStyleBlock('what changed in this PR?', 'human')).toBe(
      [
        '<chat-style>',
        'Selected style: Human.',
        'Write like a helpful coworker in a normal conversation. Keep the flow natural and let the wording carry the answer instead of structure.',
        '</chat-style>',
        '',
        'what changed in this PR?',
      ].join('\n')
    );
  });

  it('leaves multi-line user text below the block untouched', () => {
    const prompt = 'line one\n\n  line two with trailing space \n';
    const result = prependChatStyleBlock(prompt, 'direct');
    expect(result.endsWith(`\n\n${prompt}`)).toBe(true);
    expect(result.slice(result.indexOf('</chat-style>') + '</chat-style>'.length)).toBe(
      `\n\n${prompt}`
    );
  });

  it('returns the prompt strictly identical for default', () => {
    const prompt = '  hello there\n\nstill here ';
    expect(prependChatStyleBlock(prompt, 'default')).toBe(prompt);
  });

  it('returns the prompt strictly identical for unknown or missing styles', () => {
    const prompt = '  hello there\n\nstill here ';
    expect(prependChatStyleBlock(prompt, 'casual')).toBe(prompt);
    expect(prependChatStyleBlock(prompt, undefined)).toBe(prompt);
    expect(prependChatStyleBlock(prompt, '')).toBe(prompt);
  });

  it('never emits the tag when there is no block', () => {
    expect(prependChatStyleBlock('plain text', 'default')).not.toContain('<chat-style>');
  });
});

describe('retired style values', () => {
  it("reads a conversation stored on the retired 'analytical' style as Default", () => {
    expect(recordedChatStyle({ chatStyle: 'analytical' })).toBe('default');
  });

  it('leaves a prompt untouched when the retired value is selected', () => {
    expect(prependChatStyleBlock('hello', 'analytical')).toBe('hello');
  });
});

// ── AC-03: admin-edited prompt text ─────────────────────────────────────────
//
// `buildChatStyleBlock` stays synchronous and never reads the config file; it
// pulls overrides through a provider registered at server start. These pin the
// two directions that matter: an override reaches the block, and an absent
// override reproduces today's byte-for-byte output.
describe('buildChatStyleBlock with admin prompt overrides', () => {
  afterEach(() => {
    setChatStylePromptOverridesProvider(undefined);
  });

  it('uses the override text and keeps the Selected style line', () => {
    setChatStylePromptOverridesProvider(() => ({ direct: 'SENTINEL-DIRECT-PROMPT' }));

    expect(buildChatStyleBlock('direct')).toBe(
      ['<chat-style>', 'Selected style: Direct.', 'SENTINEL-DIRECT-PROMPT', '</chat-style>'].join('\n')
    );
  });

  it('leaves styles without an override on their built-in text', () => {
    setChatStylePromptOverridesProvider(() => ({ direct: 'SENTINEL-DIRECT-PROMPT' }));

    expect(buildChatStyleBlock('human')).toBe(
      [
        '<chat-style>',
        'Selected style: Human.',
        CHAT_STYLE_FOCUS_LINES.human,
        '</chat-style>',
      ].join('\n')
    );
  });

  it('reproduces the pre-override block exactly when no override is configured', () => {
    const builtIn = CHAT_STYLES.filter(style => style !== 'default').map(style => buildChatStyleBlock(style));

    for (const empty of [undefined, {}, { direct: '   ' }]) {
      setChatStylePromptOverridesProvider(() => empty);
      expect(CHAT_STYLES.filter(style => style !== 'default').map(style => buildChatStyleBlock(style)))
        .toEqual(builtIn);
    }
  });

  it('still emits nothing for default even when the config names it', () => {
    setChatStylePromptOverridesProvider(() => ({ default: 'should be ignored' }));

    expect(buildChatStyleBlock('default')).toBeUndefined();
  });

  // A hand-edited config or a provider registered before config load must never
  // fail a chat — injection degrades to the built-in wording.
  it('falls back to built-in text when the provider throws or returns garbage', () => {
    setChatStylePromptOverridesProvider(() => { throw new Error('config unavailable'); });
    expect(buildChatStyleBlock('structured')).toContain(CHAT_STYLE_FOCUS_LINES.structured);

    setChatStylePromptOverridesProvider(() => 'not-an-object');
    expect(buildChatStyleBlock('structured')).toContain(CHAT_STYLE_FOCUS_LINES.structured);

    setChatStylePromptOverridesProvider(() => ({ structured: 42 }));
    expect(buildChatStyleBlock('structured')).toContain(CHAT_STYLE_FOCUS_LINES.structured);
  });
});

describe('accepted follow-up turn identity with turn-index gaps', () => {
  let directory: string | undefined;
  let store: SqliteProcessStore | undefined;

  afterEach(() => {
    store?.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    store = undefined;
    directory = undefined;
  });

  // Regression: the enqueued follow-up predicted its turn as `conversationTurns.length`
  // while the store appends at MAX(turnIndex) + 1. After a gap (a replaced streaming
  // placeholder, a purged turn) the finished turn failed with
  // "Chat style user turn is unavailable" after the assistant had already run.
  it('records style on the exact user turn the enqueued follow-up was accepted as', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-style-gap-'));
    store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
    const turn = (turnIndex: number, role: 'user' | 'assistant', content: string): ConversationTurn =>
      ({ role, content, turnIndex, timestamp: new Date('2026-01-01T00:00:00Z'), timeline: [] });
    await store.addProcess({
      id: 'gap-chat', type: 'chat', status: 'completed', promptPreview: 'first', fullPrompt: 'first',
      startTime: new Date('2026-01-01T00:00:00Z'), metadata: { type: 'chat', workspaceId: 'owner' },
      conversationTurns: [turn(0, 'user', 'first'), turn(1, 'assistant', 'one'), turn(3, 'assistant', 'two')],
    } as AIProcess);
    const enqueue = vi.fn().mockResolvedValue('task-1');
    const service = new ProcessMessageDeliveryService({
      store, bridge: { enqueue, findTaskByProcessId: vi.fn() } as unknown as QueueExecutorBridge,
    });

    const result = await service.deliver((await store.getProcess('gap-chat'))!, {
      content: 'next', displayContent: 'next', deliveryMode: 'enqueue', pasteExternalized: false, chatStyle: 'direct',
    });

    expect(result.path).toBe('enqueued');
    const accepted = (await store.getProcess('gap-chat'))!.conversationTurns!.at(-1)!;
    expect(accepted).toMatchObject({ role: 'user', content: 'next', turnIndex: 4 });
    const cutoff = enqueue.mock.calls[0][0].payload.historyCutoffTurnIndex;
    expect(cutoff).toBe(accepted.turnIndex);

    const block = buildChatStyleBlock('direct')!;
    await persistChatStyleOnUserTurn(store, 'gap-chat', 'direct', block, cutoff);

    const after = (await store.getProcess('gap-chat'))!;
    expect(after.conversationTurns!.map(t => t.content)).toEqual(['first', 'one', 'two', `${block}\n\nnext`]);
    expect(after.metadata?.chatStyleContext).toMatchObject({ style: 'direct', block, turnIndex: 4, throughTurnIndex: 4 });
  });

  it('still fails loudly when the accepted turn is not a user turn', async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-style-gap-'));
    store = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
    await store.addProcess({
      id: 'gap-chat', type: 'chat', status: 'completed', promptPreview: 'p', fullPrompt: 'p',
      startTime: new Date(), metadata: { type: 'chat' },
      conversationTurns: [
        { role: 'user', content: 'first', turnIndex: 0, timestamp: new Date(), timeline: [] },
        { role: 'assistant', content: 'two', turnIndex: 2, timestamp: new Date(), timeline: [] },
      ],
    } as AIProcess);
    await expect(persistChatStyleOnUserTurn(store, 'gap-chat', 'direct', buildChatStyleBlock('direct'), 2))
      .rejects.toThrow('Chat style user turn is unavailable');
    expect((await store.getProcess('gap-chat'))!.conversationTurns!.map(t => t.content)).toEqual(['first', 'two']);
  });
});
