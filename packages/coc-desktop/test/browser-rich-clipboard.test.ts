import { describe, expect, it, vi } from 'vitest';
import { withRichClipboard } from '../src/browser-rich-clipboard';

describe('desktop-wide rich clipboard admission', () => {
    const signal = () => new AbortController().signal;
    const payload = ['<b>Synthetic</b>', 'Synthetic'] as const;

    it('refuses a nonempty clipboard without reading or replacing its contents', async () => {
        const clipboard = { availableFormats: () => ['text/plain'], write: vi.fn() };
        const operation = vi.fn(async () => {});
        await expect(withRichClipboard(clipboard, ...payload, false, signal(), operation)).rejects.toThrow('authorize replaceClipboard');
        expect(operation).not.toHaveBeenCalled();
        expect(clipboard.write).not.toHaveBeenCalled();
    });

    it('writes both formats only after target preparation and explicit replacement consent', async () => {
        const clipboard = { availableFormats: () => ['custom-format'], write: vi.fn() };
        await withRichClipboard(clipboard, ...payload, true, signal(), async write => {
            expect(clipboard.write).not.toHaveBeenCalled();
            write();
        });
        expect(clipboard.write).toHaveBeenCalledExactlyOnceWith({ html: payload[0], text: payload[1] });
    });

    it('serializes different views and releases the barrier on failure', async () => {
        const clipboard = { availableFormats: () => [], write: vi.fn() };
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const first = withRichClipboard(clipboard, ...payload, false, signal(), async write => { write(); await blocked; throw new Error('Synthetic failure'); });
        const second = withRichClipboard(clipboard, ...payload, false, signal(), async write => { write(); });
        await Promise.resolve();
        await Promise.resolve();
        expect(clipboard.write).toHaveBeenCalledTimes(1);
        release();
        await expect(first).rejects.toThrow('Synthetic failure');
        await second;
        expect(clipboard.write).toHaveBeenCalledTimes(2);
    });

    it('checks cancellation and clipboard changes immediately before writing', async () => {
        const controller = new AbortController();
        const clipboard = { availableFormats: vi.fn((): string[] => []), write: vi.fn() };
        await expect(withRichClipboard(clipboard, ...payload, false, controller.signal, async write => {
            controller.abort(new Error('Synthetic cancellation'));
            write();
        })).rejects.toThrow('Synthetic cancellation');
        expect(clipboard.write).not.toHaveBeenCalled();
        clipboard.availableFormats.mockReturnValueOnce([]).mockReturnValueOnce(['text/plain']);
        await expect(withRichClipboard(clipboard, ...payload, false, signal(), async write => { write(); })).rejects.toThrow('Clipboard changed');
        expect(clipboard.write).not.toHaveBeenCalled();
    });
});
