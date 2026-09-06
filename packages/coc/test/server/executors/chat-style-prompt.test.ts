import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_STYLES } from '@plusplusoneplusplus/coc-client';

import {
  buildChatStyleBlock,
  prependChatStyleBlock,
  recordedChatStyle,
  setChatStylePromptOverridesProvider,
} from '../../../src/server/executors/chat-style-prompt';
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
        'Lead with the answer or action, then only what the user needs to act on it. Short sentences, plain words. Cut preamble, softening, and background they did not ask for — short, not compressed.',
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
    for (const style of ['human', 'direct', 'structured']) {
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
