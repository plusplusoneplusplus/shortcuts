import { describe, expect, it } from 'vitest';
import { BROWSER_ACTIONS, BROWSER_SCHEMA_CHAR_BUDGET, BROWSER_TOOL_DESCRIPTION, BROWSER_TOOL_PARAMETERS, parseBrowserCommand, type BrowserCommand } from '../src/browser-control';

const valid: BrowserCommand[] = [
    { action: 'tabs' }, { action: 'open', url: 'https://fixture.test/', newTab: true },
    { action: 'select', tab: '1:view' }, { action: 'snapshot', ref: 'e1', all: true },
    { action: 'read', ref: 'e1', offset: 4 }, { action: 'click', ref: 'e1' },
    { action: 'type', ref: 'e1', text: '', submit: true }, { action: 'select_option', ref: 'e1', value: '' },
    { action: 'press', key: 'Enter' }, { action: 'scroll', ref: 'e1' },
    { action: 'navigate', direction: 'back' }, { action: 'wait', ms: 30_000 },
    { action: 'screenshot', ref: 'e1' }, { action: 'eval', js: 'document.title' },
];

describe('single browser command contract', () => {
    it('declares exactly the 14 accepted actions in a closed single-tool schema', () => {
        expect(BROWSER_ACTIONS).toHaveLength(14);
        expect(valid.map(command => command.action)).toEqual([...BROWSER_ACTIONS]);
        expect(BROWSER_TOOL_PARAMETERS.additionalProperties).toBe(false);
        expect(BROWSER_TOOL_PARAMETERS.required).toEqual(['action']);
    });

    it('keeps the serialized tool schema plus description below the measured budget', () => {
        expect(JSON.stringify(BROWSER_TOOL_PARAMETERS).length + BROWSER_TOOL_DESCRIPTION.length).toBeLessThanOrEqual(BROWSER_SCHEMA_CHAR_BUDGET);
    });

    it.each(valid)('accepts $action parameters', command => {
        expect(parseBrowserCommand(command)).toEqual(command);
    });

    it.each(valid)('rejects extra parameters for $action', command => {
        expect(() => parseBrowserCommand({ ...command, extra: true })).toThrow('unexpected parameter extra');
    });

    it.each([
        ['open', 'url'], ['select', 'tab'], ['click', 'ref'], ['type', 'ref'],
        ['select_option', 'value'], ['press', 'key'], ['navigate', 'direction'], ['eval', 'js'],
    ])('requires %s parameter %s', (action, param) => {
        const command = valid.find(command => command.action === action)!;
        const incomplete: Record<string, unknown> = { ...command };
        delete incomplete[param];
        expect(() => parseBrowserCommand(incomplete)).toThrow(`${param} is required`);
    });

    it.each([null, [], 'tabs', {}, { action: 'unknown' }])('rejects invalid input %j', input => {
        expect(() => parseBrowserCommand(input)).toThrow();
    });

    it.each([
        { action: 'wait' }, { action: 'wait', ms: 2, text: 'ready' },
        { action: 'wait', text: ' ' }, { action: 'wait', ms: -1 }, { action: 'wait', ms: 30_001 },
        { action: 'wait', ms: 1.5 }, { action: 'read', offset: Infinity }, { action: 'read', offset: -1 },
        { action: 'scroll' }, { action: 'scroll', direction: 'back' },
        { action: 'navigate', direction: 'up' }, { action: 'type', ref: 'e1', text: false },
        { action: 'open', url: 'https://fixture.test/', newTab: 1 },
        { action: 'snapshot', all: 'yes' }, { action: 'click', ref: '' },
        { action: 'tabs', ref: 'e1' }, { action: 'type', ref: 'e1' },
    ])('rejects missing/contradictory/wrongly typed parameters %j', input => {
        expect(() => parseBrowserCommand(input)).toThrow();
    });

    it('accepts zero waits, text waits and direction-plus-target scrolling', () => {
        expect(parseBrowserCommand({ action: 'wait', ms: 0 })).toEqual({ action: 'wait', ms: 0 });
        expect(parseBrowserCommand({ action: 'wait', text: 'ready' })).toEqual({ action: 'wait', text: 'ready' });
        expect(parseBrowserCommand({ action: 'scroll', ref: 'e1', direction: 'left' })).toEqual({ action: 'scroll', ref: 'e1', direction: 'left' });
    });
});
