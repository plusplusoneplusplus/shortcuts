import { describe, expect, it } from 'vitest';
import { validateBrowserCommandRequest } from '../src/browser-control-command';

const request = (command: unknown) => ({ id: 'r', workspaceId: 'w', processId: 'p', command });
describe('desktop browser command validation', () => {
    it.each([
        { action: 'tabs' }, { action: 'open', url: 'https://fixture.test/', newTab: true },
        { action: 'select', tab: 't1:view' }, { action: 'snapshot', all: true, ref: 'e1' },
        { action: 'read', offset: 100 }, { action: 'click', ref: 'e1' },
        { action: 'type', ref: 'e1', text: '', submit: true }, { action: 'select_option', ref: 'e2', value: '' },
        { action: 'press', key: 'Enter' }, { action: 'scroll', ref: 'e1' }, { action: 'scroll', direction: 'up' },
        { action: 'navigate', direction: 'back' }, { action: 'wait', ms: 0 }, { action: 'wait', text: 'loaded' },
        { action: 'screenshot', ref: 'e1' }, { action: 'eval', js: '({ok:true})' },
    ])('accepts %j', command => { expect(validateBrowserCommandRequest(request(command)).command).toEqual(command); });
    it.each([
        null, [], {}, { action: 'constructor' }, { action: 'unknown' }, { action: 'open' }, { action: 'open', url: 'file:///private' },
        { action: 'tabs', js: 'evil' }, { action: 'snapshot', all: 'true' }, { action: 'read', offset: -1 },
        { action: 'read', offset: NaN }, { action: 'click', ref: 'e0' }, { action: 'click' },
        { action: 'type', ref: 'e1', text: [] }, { action: 'type', ref: 'e1' },
        { action: 'select_option', ref: 'e1' }, { action: 'press', key: '' }, { action: 'navigate', direction: 'stop' },
        { action: 'scroll' }, { action: 'scroll', direction: 'around' }, { action: 'wait', text: 'x', ms: 2 },
        { action: 'wait', text: ' ' }, { action: 'wait', ms: 30001 }, { action: 'wait', ms: '1' },
        { action: 'wait' }, { action: 'eval' }, { action: 'select', tab: {} },
    ])('rejects %j at the IPC boundary', command => { expect(() => validateBrowserCommandRequest(request(command))).toThrow(); });
    it.each([
        null, [], { ...request({ action: 'tabs' }), workspaceId: null },
        { ...request({ action: 'tabs' }), selectedTab: {} }, { ...request({ action: 'tabs' }), cdp: 'Page.navigate' },
    ])('rejects malformed envelope %j', input => { expect(() => validateBrowserCommandRequest(input)).toThrow(); });
});
