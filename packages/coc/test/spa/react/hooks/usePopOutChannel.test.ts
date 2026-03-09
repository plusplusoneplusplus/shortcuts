/**
 * Tests for usePopOutChannel hook (source-level verification).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HOOKS_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'hooks'
);
const SOURCE = fs.readFileSync(path.join(HOOKS_DIR, 'usePopOutChannel.ts'), 'utf-8');

describe('usePopOutChannel: structure', () => {
    it('exports usePopOutChannel function', () => {
        expect(SOURCE).toContain('export function usePopOutChannel');
    });

    it('exports PopOutMessage type', () => {
        expect(SOURCE).toContain("export type PopOutMessage");
    });

    it('exports POPOUT_CHANNEL_NAME constant', () => {
        expect(SOURCE).toContain("export const POPOUT_CHANNEL_NAME");
    });

    it('exports POPOUT_LS_FALLBACK_KEY constant', () => {
        expect(SOURCE).toContain("export const POPOUT_LS_FALLBACK_KEY");
    });
});

describe('usePopOutChannel: BroadcastChannel integration', () => {
    it('creates a BroadcastChannel with the channel name', () => {
        expect(SOURCE).toContain("new BroadcastChannel(POPOUT_CHANNEL_NAME)");
    });

    it('attaches onmessage handler to channel', () => {
        expect(SOURCE).toContain("channel.onmessage");
    });

    it('closes channel on cleanup', () => {
        expect(SOURCE).toContain("channel.close()");
    });

    it('returns a postMessage function', () => {
        expect(SOURCE).toContain("return { postMessage }");
    });
});

describe('usePopOutChannel: message types', () => {
    it('supports popout-opened message type', () => {
        expect(SOURCE).toContain("'popout-opened'");
    });

    it('supports popout-closed message type', () => {
        expect(SOURCE).toContain("'popout-closed'");
    });

    it('supports popout-restore message type', () => {
        expect(SOURCE).toContain("'popout-restore'");
    });
});

describe('usePopOutChannel: localStorage fallback', () => {
    it('checks for BroadcastChannel availability', () => {
        expect(SOURCE).toContain("typeof BroadcastChannel");
    });

    it('uses localStorage fallback key', () => {
        expect(SOURCE).toContain("POPOUT_LS_FALLBACK_KEY");
    });

    it('listens for storage events as fallback', () => {
        expect(SOURCE).toContain("window.addEventListener('storage'");
    });
});
