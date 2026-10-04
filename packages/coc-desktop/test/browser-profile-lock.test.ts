import { describe, expect, it } from 'vitest';
import { lockElectronProfile } from '../src/browser-profile-lock';
import { mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('persistent browser profile lease', () => {
    it('rejects a competing profile owner and releases the lock on close', () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), 'coc-profile-lock-'));
        const profile = path.join(directory, 'browser', 'electron');
        const first = lockElectronProfile(profile);
        let firstOpen = true;
        try {
            expect(() => lockElectronProfile(profile)).toThrow(/profile is in use/);
            first.close();
            firstOpen = false;
            const second = lockElectronProfile(profile);
            second.close();
        } finally {
            if (firstOpen) first.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
