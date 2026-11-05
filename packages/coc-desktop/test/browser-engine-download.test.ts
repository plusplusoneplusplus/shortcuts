import * as path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { BrowserWindow, SaveDialogOptions, SaveDialogReturnValue } from 'electron';
import type { DownloadRecord } from '../src/browser-downloads';

const { installDownloadChooser, completedDownload } = createRequire(import.meta.url)('./e2e/browser-engine-download.cjs') as {
    installDownloadChooser(dialog: {
        showSaveDialog(window: BrowserWindow | null, options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
    }, directory: string): void;
    completedDownload(result: {
        ok: boolean;
        engines?: Partial<Record<DownloadRecord['engine'], { managed: boolean }>>;
        entries?: Partial<DownloadRecord>[];
    }, engine: DownloadRecord['engine']): Partial<DownloadRecord> | undefined;
};

describe('browser engine managed download fixture', () => {
    it('selects only the expected fixture destination without opening a native dialog', async () => {
        const directory = path.resolve('fixture-downloads');
        const destination = path.join(directory, 'fixture.zip');
        const dialog = {
            showSaveDialog: async (_window: BrowserWindow | null, _options: SaveDialogOptions): Promise<SaveDialogReturnValue> => {
                throw new Error('Unexpected native dialog.');
            },
        };
        installDownloadChooser(dialog, directory);
        await expect(dialog.showSaveDialog(null, {
            title: 'Save browser download', defaultPath: destination,
        })).resolves.toEqual({ canceled: false, filePath: destination });
        await expect(dialog.showSaveDialog(null, {
            title: 'Unrelated save', defaultPath: destination,
        })).rejects.toThrow('Unexpected browser download chooser.');
        await expect(dialog.showSaveDialog(null, {
            title: 'Save browser download', defaultPath: path.join(directory, 'other.zip'),
        })).rejects.toThrow('Unexpected browser download chooser.');
    });

    it.each(['electron', 'webview2'] as const)('waits for a verified managed %s transfer, not a fallback notice', engine => {
        const transfer = { engine, filename: 'fixture.zip', state: 'completed' as const, fileAvailable: true };
        const result = {
            ok: true,
            engines: { electron: { managed: true }, webview2: { managed: true } },
            entries: [
                { ...transfer, engine: engine === 'electron' ? 'webview2' as const : 'electron' as const },
                { ...transfer, state: 'downloading' as const },
                { ...transfer, fileAvailable: false },
                { ...transfer, filename: 'other.zip' },
                transfer,
            ],
        };
        expect(completedDownload({ ...result, entries: result.entries.slice(0, -1) }, engine)).toBeUndefined();
        expect(completedDownload(result, engine)).toBe(transfer);
        expect(() => completedDownload({ ok: false }, engine)).toThrow(`Managed ${engine} downloads are unavailable.`);
        expect(() => completedDownload({
            ...result, engines: { ...result.engines, [engine]: { managed: false } },
        }, engine)).toThrow(`Managed ${engine} downloads are unavailable.`);
    });
});
