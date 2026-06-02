import { describe, expect, it } from 'vitest';
import { resolveModelForProvider } from '../../src/provider-model-resolver';

describe('resolveModelForProvider', () => {
    it('keeps Codex GPT models', () => {
        expect(resolveModelForProvider('codex', 'gpt-5.5')).toEqual({
            model: 'gpt-5.5',
            coerced: false,
            requestedModel: 'gpt-5.5',
        });
    });

    it('drops Claude models for Codex', () => {
        expect(resolveModelForProvider('codex', 'claude-opus-4.8')).toEqual({
            coerced: true,
            requestedModel: 'claude-opus-4.8',
        });
    });

    it('drops GPT models for Claude', () => {
        expect(resolveModelForProvider('claude', 'gpt-5.5')).toEqual({
            coerced: true,
            requestedModel: 'gpt-5.5',
        });
    });

    it('treats provider defaults as provider default without coercion', () => {
        expect(resolveModelForProvider('codex', 'provider-default')).toEqual({
            coerced: false,
            requestedModel: 'provider-default',
        });
    });
});

