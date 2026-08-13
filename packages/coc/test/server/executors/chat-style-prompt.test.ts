import { describe, expect, it } from 'vitest';

import {
  buildChatStyleBlock,
  prependChatStyleBlock,
} from '../../../src/server/executors/chat-style-prompt';

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
        'Lead with the answer or action. Use the fewest words that preserve important facts. Cut preamble, softening, repetition, and background the user did not ask for.',
        '</chat-style>',
      ].join('\n')
    );
  });

  it('builds the analytical block verbatim', () => {
    expect(buildChatStyleBlock('analytical')).toBe(
      [
        '<chat-style>',
        'Selected style: Analytical.',
        'Explain the reasoning. Surface assumptions, evidence, causes, alternatives, and tradeoffs, and say what the risks are. Give a useful summary of the reasoning and its conclusions rather than a raw transcript of your internal thinking.',
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
    for (const style of ['human', 'direct', 'analytical', 'structured']) {
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
