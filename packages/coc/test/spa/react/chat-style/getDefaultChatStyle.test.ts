/**
 * getDefaultChatStyle — the SPA read path for the server-wide
 * `features.defaultChatStyle` admin setting.
 *
 * The composers use this to seed their Style chip, so an unknown or missing
 * value has to read as `'default'` rather than propagate onto the wire: a
 * server that predates the setting omits the flag entirely.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyRuntimeConfigPatch, getDefaultChatStyle } from '../../../../src/server/spa/client/react/utils/config';

describe('getDefaultChatStyle', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ defaultChatStyle: 'default' });
    });

    it('reads the configured style', () => {
        for (const style of ['default', 'human', 'direct', 'structured'] as const) {
            applyRuntimeConfigPatch({ defaultChatStyle: style });
            expect(getDefaultChatStyle()).toBe(style);
        }
    });

    it("falls back to 'default' when the server omits the flag", () => {
        applyRuntimeConfigPatch({ defaultChatStyle: undefined });
        expect(getDefaultChatStyle()).toBe('default');
    });

    it("falls back to 'default' for a value this client does not know", () => {
        applyRuntimeConfigPatch({ defaultChatStyle: 'sassy' as never });
        expect(getDefaultChatStyle()).toBe('default');
    });
});
