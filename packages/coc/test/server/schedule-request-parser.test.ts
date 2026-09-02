/**
 * Tests for schedule REST body parsing.
 *
 * Error messages are the API contract, so they are asserted verbatim.
 */

import { describe, it, expect } from 'vitest';
import {
    parseScheduleCreateBody,
    parseScheduleUpdateBody,
    validateScheduleInput,
} from '../../src/server/schedule/schedule-request-parser';

function validBody(overrides: Record<string, unknown> = {}) {
    return { name: 'Daily', target: 'daily.md', cron: '0 9 * * *', ...overrides };
}

function expectError<T>(result: { ok: boolean; error?: string }, message: string) {
    expect(result.ok).toBe(false);
    expect(result.error).toBe(message);
}

describe('parseScheduleCreateBody', () => {
    it('applies defaults for every optional field', () => {
        const result = parseScheduleCreateBody(validBody());
        expect(result.ok).toBe(true);
        expect(result.ok && result.value).toEqual({
            name: 'Daily',
            target: 'daily.md',
            cron: '0 9 * * *',
            params: {},
            onFailure: 'notify',
            status: 'active',
            targetType: 'prompt',
            outputFolder: undefined,
            model: undefined,
            mode: 'autopilot',
            provider: undefined,
        });
    });

    it('trims name, target, cron, outputFolder, and model', () => {
        const result = parseScheduleCreateBody(validBody({
            name: '  Daily  ',
            target: '  daily.md  ',
            cron: '  0 9 * * *  ',
            outputFolder: '  /tmp/out  ',
            model: '  claude-opus-5  ',
        }));
        expect(result.ok && result.value).toMatchObject({
            name: 'Daily',
            target: 'daily.md',
            cron: '0 9 * * *',
            outputFolder: '/tmp/out',
            model: 'claude-opus-5',
        });
    });

    it('keeps explicit non-default values', () => {
        const result = parseScheduleCreateBody(validBody({
            params: { flavor: 'x' },
            onFailure: 'stop',
            status: 'paused',
            targetType: 'script',
            mode: 'ask',
            provider: 'claude',
        }));
        expect(result.ok && result.value).toMatchObject({
            params: { flavor: 'x' },
            onFailure: 'stop',
            status: 'paused',
            targetType: 'script',
            mode: 'ask',
            provider: 'claude',
        });
    });

    it.each([
        [{ name: '   ' }, 'Missing required field: name'],
        [{ target: '' }, 'Missing required field: target'],
        [{ cron: '' }, 'Missing required field: cron'],
        [{ cron: 'not-a-cron' }, 'Invalid cron expression: not-a-cron'],
        [{ onFailure: 'explode' }, 'Invalid onFailure: explode. Valid values: notify, stop'],
        [{ status: 'sleeping' }, 'Invalid status: sleeping. Valid values: active, paused, stopped'],
        [{ targetType: 'pipeline' }, 'Invalid targetType: pipeline. Valid values: prompt, script'],
        [{ mode: 'ralph' }, 'Invalid mode: ralph. Valid values: ask, autopilot'],
        [{ provider: 'gpt' }, 'Invalid provider: gpt. Valid values: copilot, codex, claude, opencode'],
    ])('rejects %j', (overrides, message) => {
        expectError(parseScheduleCreateBody(validBody(overrides)), message);
    });

    it('exposes the same checks through validateScheduleInput', () => {
        expect(validateScheduleInput(validBody())).toEqual({ valid: true });
        expect(validateScheduleInput(validBody({ name: '' })))
            .toEqual({ valid: false, error: 'Missing required field: name' });
    });
});

describe('parseScheduleUpdateBody', () => {
    it('produces an empty update for an empty body', () => {
        const result = parseScheduleUpdateBody({});
        expect(result.ok && result.value).toEqual({});
    });

    it('omits absent fields so they are never cleared', () => {
        const result = parseScheduleUpdateBody({ name: 'Renamed' });
        expect(result.ok && Object.keys(result.value)).toEqual(['name']);
    });

    it('trims the fields it copies', () => {
        const result = parseScheduleUpdateBody({ name: ' N ', target: ' t ', cron: ' 0 9 * * * ' });
        expect(result.ok && result.value).toEqual({ name: 'N', target: 't', cron: '0 9 * * *' });
    });

    it('maps a blank outputFolder or model to undefined (clearing it)', () => {
        const result = parseScheduleUpdateBody({ outputFolder: '', model: '   ' });
        expect(result.ok && result.value).toEqual({ outputFolder: undefined, model: undefined });
        expect(result.ok && 'outputFolder' in result.value).toBe(true);
        expect(result.ok && 'model' in result.value).toBe(true);
    });

    it('accepts an empty or null provider as a clear', () => {
        expect(parseScheduleUpdateBody({ provider: '' })).toEqual({ ok: true, value: { provider: undefined } });
        expect(parseScheduleUpdateBody({ provider: null })).toEqual({ ok: true, value: { provider: undefined } });
    });

    it('preserves params set to an empty object', () => {
        const result = parseScheduleUpdateBody({ params: {} });
        expect(result.ok && result.value).toEqual({ params: {} });
    });

    it.each([
        [{ cron: 'nope' }, 'Invalid cron expression: nope'],
        [{ onFailure: 'explode' }, 'Invalid onFailure: explode'],
        [{ status: 'sleeping' }, 'Invalid status: sleeping'],
        [{ targetType: 'pipeline' }, 'Invalid targetType: pipeline. Valid values: prompt, script'],
        [{ mode: 'ralph' }, 'Invalid mode: ralph. Valid values: ask, autopilot'],
        [{ provider: 'gpt' }, 'Invalid provider: gpt. Valid values: copilot, codex, claude, opencode'],
    ])('rejects %j', (body, message) => {
        expectError(parseScheduleUpdateBody(body), message);
    });
});
