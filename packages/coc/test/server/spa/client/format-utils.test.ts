/**
 * Tests for format utility functions.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyHtmlToClipboard, copyToClipboard } from '../../../../src/server/spa/client/react/utils/format';

describe('copyHtmlToClipboard', () => {
    let appendChildSpy: ReturnType<typeof vi.spyOn>;
    let removeChildSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
        removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('modern ClipboardItem path', () => {
        it('writes html and plain text blobs via clipboard.write', async () => {
            const writeSpy = vi.fn().mockResolvedValue(undefined);
            Object.assign(navigator, {
                clipboard: { write: writeSpy, writeText: vi.fn() },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).ClipboardItem = class MockClipboardItem {
                items: Record<string, Blob>;
                constructor(items: Record<string, Blob>) {
                    this.items = items;
                }
            };

            const html = '<h1>Hello</h1>';
            await copyHtmlToClipboard(html);

            expect(writeSpy).toHaveBeenCalledTimes(1);
            const item = writeSpy.mock.calls[0][0][0];
            expect(item.items['text/html']).toBeInstanceOf(Blob);
            expect(item.items['text/plain']).toBeInstanceOf(Blob);
            expect(item.items['text/html'].type).toBe('text/html');
            expect(item.items['text/plain'].type).toBe('text/plain');

            // Cleanup
            delete (globalThis as any).ClipboardItem;
        });
    });

    describe('fallback execCommand path', () => {
        it('copies HTML via contenteditable div when ClipboardItem is unavailable', async () => {
            // Ensure ClipboardItem is not defined
            delete (globalThis as any).ClipboardItem;
            Object.assign(navigator, {
                clipboard: { writeText: vi.fn() },
            });

            // jsdom does not implement execCommand; define it
            (document as any).execCommand = vi.fn().mockReturnValue(true);

            const mockRange = {
                selectNodeContents: vi.fn(),
            };
            vi.spyOn(document, 'createRange').mockReturnValue(mockRange as any);

            const mockSelection = {
                removeAllRanges: vi.fn(),
                addRange: vi.fn(),
            };
            vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any);

            const html = '<p>Test <strong>bold</strong></p>';
            await copyHtmlToClipboard(html);

            expect(appendChildSpy).toHaveBeenCalledTimes(1);
            const div = appendChildSpy.mock.calls[0][0] as HTMLDivElement;
            expect(div.innerHTML).toBe(html);
            expect(div.contentEditable).toBe('true');

            expect(mockRange.selectNodeContents).toHaveBeenCalledWith(div);
            expect(mockSelection.removeAllRanges).toHaveBeenCalled();
            expect(mockSelection.addRange).toHaveBeenCalledWith(mockRange);
            expect((document as any).execCommand).toHaveBeenCalledWith('copy');
            expect(removeChildSpy).toHaveBeenCalledWith(div);
        });
    });

    it('handles empty string without throwing', async () => {
        delete (globalThis as any).ClipboardItem;
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn() },
        });
        (document as any).execCommand = vi.fn().mockReturnValue(true);
        vi.spyOn(document, 'createRange').mockReturnValue({
            selectNodeContents: vi.fn(),
        } as any);
        vi.spyOn(window, 'getSelection').mockReturnValue({
            removeAllRanges: vi.fn(),
            addRange: vi.fn(),
        } as any);

        await expect(copyHtmlToClipboard('')).resolves.toBeUndefined();
    });
});

describe('copyToClipboard (existing)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses navigator.clipboard.writeText when available', async () => {
        const writeTextSpy = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, {
            clipboard: { writeText: writeTextSpy },
        });

        await copyToClipboard('hello');
        expect(writeTextSpy).toHaveBeenCalledWith('hello');
    });
});
