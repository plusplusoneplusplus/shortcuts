// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFileAttachments } from '../../../src/server/spa/client/react/hooks/useFileAttachments';

let fileCounter = 0;
const OriginalFileReader = globalThis.FileReader;

function createMockPasteEvent(items: Array<{ kind: string; type: string; getAsFile: () => File | null }>): React.ClipboardEvent {
    const preventDefault = vi.fn();
    return {
        clipboardData: {
            items: items.map(item => ({
                kind: item.kind,
                type: item.type,
                getAsFile: item.getAsFile,
            })),
        },
        preventDefault,
    } as unknown as React.ClipboardEvent;
}

function createImageFile(name = 'screenshot.png'): File {
    return new File(['fake-png-data'], name, { type: 'image/png' });
}

function createTextFile(name = 'readme.md', content = '# Hello'): File {
    return new File([content], name, { type: 'text/markdown' });
}

function createBinaryFile(name = 'archive.zip'): File {
    return new File(['PK\x03\x04'], name, { type: 'application/zip' });
}

function createFileItem(file: File): { kind: string; type: string; getAsFile: () => File } {
    return {
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
    };
}

beforeEach(() => {
    fileCounter = 0;
    // Mock FileReader to synchronously fire onload
    globalThis.FileReader = function (this: any) {
        const idx = fileCounter++;
        this.onload = null;
        this.readAsDataURL = (file: File) => {
            const prefix = file.type.startsWith('image/') ? `data:${file.type}` : `data:${file.type || 'application/octet-stream'}`;
            if (this.onload) {
                this.onload({ target: { result: `${prefix};base64,content${idx}` } });
            }
        };
    } as any;
});

afterEach(() => {
    vi.restoreAllMocks();
    if (OriginalFileReader) globalThis.FileReader = OriginalFileReader;
});

describe('useFileAttachments', () => {
    it('returns empty attachments and images initially', () => {
        const { result } = renderHook(() => useFileAttachments());
        expect(result.current.attachments).toEqual([]);
        expect(result.current.images).toEqual([]);
        expect(result.current.error).toBeNull();
    });

    it('addFromPaste handles image files from clipboard', () => {
        const { result } = renderHook(() => useFileAttachments());
        const file = createImageFile();
        const event = createMockPasteEvent([createFileItem(file)]);

        act(() => { result.current.addFromPaste(event); });

        expect(result.current.attachments).toHaveLength(1);
        expect(result.current.attachments[0].name).toBe('screenshot.png');
        expect(result.current.attachments[0].category).toBe('image');
        expect(result.current.attachments[0].mimeType).toBe('image/png');
        expect(event.preventDefault).toHaveBeenCalled();
    });

    it('addFromPaste handles text files from clipboard', () => {
        const { result } = renderHook(() => useFileAttachments());
        const file = createTextFile();
        const event = createMockPasteEvent([createFileItem(file)]);

        act(() => { result.current.addFromPaste(event); });

        expect(result.current.attachments).toHaveLength(1);
        expect(result.current.attachments[0].name).toBe('readme.md');
        expect(result.current.attachments[0].category).toBe('text');
    });

    it('addFromPaste handles binary files from clipboard', () => {
        const { result } = renderHook(() => useFileAttachments());
        const file = createBinaryFile();
        const event = createMockPasteEvent([createFileItem(file)]);

        act(() => { result.current.addFromPaste(event); });

        expect(result.current.attachments).toHaveLength(1);
        expect(result.current.attachments[0].name).toBe('archive.zip');
        expect(result.current.attachments[0].category).toBe('binary');
    });

    it('images getter returns only image data URLs', () => {
        const { result } = renderHook(() => useFileAttachments());

        act(() => {
            result.current.addFromPaste(createMockPasteEvent([createFileItem(createImageFile())]));
        });
        act(() => {
            result.current.addFromPaste(createMockPasteEvent([createFileItem(createTextFile())]));
        });

        expect(result.current.attachments).toHaveLength(2);
        expect(result.current.images).toHaveLength(1);
        expect(result.current.images[0]).toMatch(/^data:image\/png/);
    });

    it('addFromFileInput adds multiple files', () => {
        const { result } = renderHook(() => useFileAttachments());
        const files = [createImageFile('a.png'), createTextFile('b.ts', 'const x = 1;')];

        act(() => { result.current.addFromFileInput(files); });

        expect(result.current.attachments).toHaveLength(2);
        expect(result.current.attachments[0].name).toBe('a.png');
        expect(result.current.attachments[1].name).toBe('b.ts');
    });

    it('respects maxAttachments limit', () => {
        const { result } = renderHook(() => useFileAttachments(2));

        for (let i = 0; i < 4; i++) {
            act(() => {
                result.current.addFromPaste(
                    createMockPasteEvent([createFileItem(createImageFile(`img${i}.png`))])
                );
            });
        }

        expect(result.current.attachments).toHaveLength(2);
        expect(result.current.error).toBeTruthy();
    });

    it('rejects files exceeding MAX_FILE_SIZE', () => {
        const { result } = renderHook(() => useFileAttachments());
        // Create a file object with a large size property
        const bigFile = new File(['x'], 'huge.bin', { type: 'application/octet-stream' });
        Object.defineProperty(bigFile, 'size', { value: 11 * 1024 * 1024 });

        act(() => { result.current.addFromFileInput([bigFile]); });

        expect(result.current.attachments).toHaveLength(0);
        expect(result.current.error).toContain('huge.bin');
        expect(result.current.error).toContain('10 MB');
    });

    it('removeAttachment removes by id', () => {
        const { result } = renderHook(() => useFileAttachments());

        act(() => {
            result.current.addFromPaste(createMockPasteEvent([createFileItem(createImageFile('a.png'))]));
        });
        act(() => {
            result.current.addFromPaste(createMockPasteEvent([createFileItem(createImageFile('b.png'))]));
        });

        expect(result.current.attachments).toHaveLength(2);
        const idToRemove = result.current.attachments[0].id;

        act(() => { result.current.removeAttachment(idToRemove); });

        expect(result.current.attachments).toHaveLength(1);
        expect(result.current.attachments[0].name).toBe('b.png');
    });

    it('clearAttachments removes all', () => {
        const { result } = renderHook(() => useFileAttachments());

        act(() => {
            result.current.addFromFileInput([createImageFile(), createTextFile()]);
        });
        expect(result.current.attachments).toHaveLength(2);

        act(() => { result.current.clearAttachments(); });

        expect(result.current.attachments).toEqual([]);
        expect(result.current.images).toEqual([]);
    });

    it('clearError clears the error', () => {
        const { result } = renderHook(() => useFileAttachments(1));

        // Fill to capacity
        act(() => {
            result.current.addFromPaste(createMockPasteEvent([createFileItem(createImageFile())]));
        });
        // Try to add one more
        act(() => {
            result.current.addFromPaste(createMockPasteEvent([createFileItem(createImageFile('extra.png'))]));
        });
        expect(result.current.error).toBeTruthy();

        act(() => { result.current.clearError(); });
        expect(result.current.error).toBeNull();
    });

    it('toPayload returns wire format without id or category', () => {
        const { result } = renderHook(() => useFileAttachments());

        act(() => {
            result.current.addFromPaste(createMockPasteEvent([createFileItem(createImageFile())]));
        });

        const payload = result.current.toPayload();
        expect(payload).toHaveLength(1);
        expect(payload[0]).toHaveProperty('name');
        expect(payload[0]).toHaveProperty('mimeType');
        expect(payload[0]).toHaveProperty('size');
        expect(payload[0]).toHaveProperty('dataUrl');
        expect(payload[0]).not.toHaveProperty('id');
        expect(payload[0]).not.toHaveProperty('category');
    });

    it('addFromPaste ignores non-file items (e.g. text/plain)', () => {
        const { result } = renderHook(() => useFileAttachments());
        const event = createMockPasteEvent([{
            kind: 'string',
            type: 'text/plain',
            getAsFile: () => null,
        }]);

        act(() => { result.current.addFromPaste(event); });

        expect(result.current.attachments).toEqual([]);
        expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('deduplicates files by name and size', () => {
        const { result } = renderHook(() => useFileAttachments());
        const file = createImageFile('same.png');

        act(() => { result.current.addFromPaste(createMockPasteEvent([createFileItem(file)])); });
        act(() => { result.current.addFromPaste(createMockPasteEvent([createFileItem(file)])); });

        expect(result.current.attachments).toHaveLength(1);
    });
});
