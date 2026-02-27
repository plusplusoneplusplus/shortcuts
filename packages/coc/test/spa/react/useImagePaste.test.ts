// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImagePaste } from '../../../src/server/spa/client/react/hooks/useImagePaste';

let imageCounter = 0;
const OriginalFileReader = globalThis.FileReader;

function createMockPasteEvent(items: Array<{ type: string; getAsFile: () => File | null }>): React.ClipboardEvent {
    const preventDefault = vi.fn();
    return {
        clipboardData: {
            items: items.map(item => ({
                type: item.type,
                getAsFile: item.getAsFile,
            })),
        },
        preventDefault,
    } as unknown as React.ClipboardEvent;
}

function createImageItem(): { type: string; getAsFile: () => File } {
    return {
        type: 'image/png',
        getAsFile: () => new File([''], 'image.png', { type: 'image/png' }),
    };
}

beforeEach(() => {
    imageCounter = 0;
    globalThis.FileReader = function (this: any) {
        const idx = imageCounter++;
        this.onload = null;
        this.readAsDataURL = () => {
            if (this.onload) {
                this.onload({ target: { result: `data:image/png;base64,img${idx}` } });
            }
        };
    } as any;
});

afterEach(() => {
    vi.restoreAllMocks();
    if (OriginalFileReader) {
        globalThis.FileReader = OriginalFileReader;
    }
});

describe('useImagePaste', () => {
    it('returns empty images array initially', () => {
        const { result } = renderHook(() => useImagePaste());
        expect(result.current.images).toEqual([]);
    });

    it('addFromPaste extracts image from clipboard', () => {
        const { result } = renderHook(() => useImagePaste());
        const event = createMockPasteEvent([createImageItem()]);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.images).toHaveLength(1);
        expect(result.current.images[0]).toMatch(/^data:image\/png;base64,/);
        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('addFromPaste ignores non-image items', () => {
        const { result } = renderHook(() => useImagePaste());
        const event = createMockPasteEvent([{
            type: 'text/plain',
            getAsFile: () => null,
        }]);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.images).toEqual([]);
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('addFromPaste respects maxImages limit', () => {
        const { result } = renderHook(() => useImagePaste(2));

        for (let i = 0; i < 3; i++) {
            const event = createMockPasteEvent([createImageItem()]);
            act(() => {
                result.current.addFromPaste(event);
            });
        }

        expect(result.current.images).toHaveLength(2);
    });

    it('removeImage removes by index', () => {
        const { result } = renderHook(() => useImagePaste());

        // Add 3 images
        for (let i = 0; i < 3; i++) {
            const event = createMockPasteEvent([createImageItem()]);
            act(() => {
                result.current.addFromPaste(event);
            });
        }
        expect(result.current.images).toHaveLength(3);
        const second = result.current.images[1];

        act(() => {
            result.current.removeImage(1);
        });

        expect(result.current.images).toHaveLength(2);
        expect(result.current.images).not.toContain(second);
    });

    it('clearImages removes all images', () => {
        const { result } = renderHook(() => useImagePaste());

        for (let i = 0; i < 2; i++) {
            const event = createMockPasteEvent([createImageItem()]);
            act(() => {
                result.current.addFromPaste(event);
            });
        }
        expect(result.current.images).toHaveLength(2);

        act(() => {
            result.current.clearImages();
        });

        expect(result.current.images).toEqual([]);
    });

    it('default maxImages is 5', () => {
        const { result } = renderHook(() => useImagePaste());

        for (let i = 0; i < 6; i++) {
            const event = createMockPasteEvent([createImageItem()]);
            act(() => {
                result.current.addFromPaste(event);
            });
        }

        expect(result.current.images).toHaveLength(5);
    });

    it('skips items where getAsFile returns null', () => {
        const { result } = renderHook(() => useImagePaste());
        const event = createMockPasteEvent([{
            type: 'image/png',
            getAsFile: () => null,
        }]);

        act(() => {
            result.current.addFromPaste(event);
        });

        expect(result.current.images).toEqual([]);
        // preventDefault is still called since an image type was found
        expect(event.preventDefault).toHaveBeenCalled();
    });
});
