/** Native Notes capability validation at the CoC composition boundary. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    NativeAddonLoadError,
    resetNativeAddonCache,
} from '@plusplusoneplusplus/coc-native';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { createExecutionServer } from '../../src/server/index';

const ENV_KEYS = ['COC_NATIVE', 'COC_NATIVE_PATH'] as const;

describe('native Notes capability at server startup', () => {
    let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;
    let tempDir: string;
    let server: ExecutionServer | undefined;

    beforeEach(() => {
        savedEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]])) as typeof savedEnv;
        for (const key of ENV_KEYS) delete process.env[key];
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-startup-'));
        resetNativeAddonCache();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        for (const key of ENV_KEYS) {
            if (savedEnv[key] === undefined) delete process.env[key];
            else process.env[key] = savedEnv[key];
        }
        resetNativeAddonCache();
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    function useAddon(source: string, name = 'stub.js'): string {
        const addonPath = path.join(tempDir, name);
        fs.writeFileSync(addonPath, source);
        process.env.COC_NATIVE_PATH = addonPath;
        return addonPath;
    }

    async function expectStartupFailure(...messageParts: string[]): Promise<void> {
        let failure: unknown;
        try {
            await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tempDir });
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(NativeAddonLoadError);
        for (const part of messageParts) expect((failure as Error).message).toContain(part);
    }

    it('fails composition when the native binary is missing', async () => {
        process.env.COC_NATIVE_PATH = path.join(tempDir, 'absent.node');

        await expectStartupFailure(
            'no native binary',
            'Build it with `npm run build:native -w packages/coc-native`',
        );
    });

    it('fails composition when the native binary is unloadable', async () => {
        const addonPath = useAddon('not a native binary', 'broken.node');

        await expectStartupFailure(
            `failed to load ${addonPath}`,
            'Caused by:',
            'npm run build:native -w packages/coc-native',
        );
    });

    it('fails composition when the binary predates Notes refresh support', async () => {
        useAddon(
            'class NotesIndex { async search() { return { results: [], truncated: false }; } } ' +
                'module.exports = { NotesIndex, buildNotesIndex: async () => new NotesIndex() };',
        );

        await expectStartupFailure(
            'does not export a Notes content index',
            'predates the Notes-index capability',
            'rebuild it with `npm run build:native -w packages/coc-native`',
        );
    });

    it('reports the loaded Notes capability after successful startup', async () => {
        const addonPath = useAddon(
            'class NotesIndex { async search() { return { results: [], truncated: false }; } ' +
                'async refresh() {} async refreshChanged() {} } ' +
                'module.exports = { buildFileIndex: async () => ({}), NotesIndex, ' +
                'buildNotesIndex: async () => new NotesIndex() };',
        );
        const stderrWrites: string[] = [];
        vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
            stderrWrites.push(String(chunk));
            return true;
        });

        server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tempDir });

        expect(stderrWrites.join('')).toContain(`native Notes index: loaded (${addonPath})`);
    });
});
