import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    formatRelativeTime,
    formatConversationAsText,
    formatConversationAsHtml,
    escapeHtml,
    imageSrcToDataUri,
    enrichSelectionHtmlWithInlineImages,
    copySelectionWithInlineImages,
} from '../../../../src/server/spa/client/react/utils/format';

const originalFetch = globalThis.fetch;
const originalClipboardItem = (globalThis as any).ClipboardItem;
const originalClipboard = navigator.clipboard;

afterEach(() => {
    vi.restoreAllMocks();
    // These tests overwrite globals directly (not via spies) — restore them so
    // the mutations don't leak into sibling spa tests sharing the worker.
    globalThis.fetch = originalFetch;
    (globalThis as any).ClipboardItem = originalClipboardItem;
    Object.assign(navigator, { clipboard: originalClipboard });
});

function mockNow(ms: number) {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
}

const BASE = new Date('2024-01-01T12:00:00.000Z').getTime();

describe('formatRelativeTime — past dates', () => {
    it('returns "just now" for 0 ms ago', () => {
        mockNow(BASE);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('just now');
    });

    it('returns "just now" for 59 seconds ago', () => {
        mockNow(BASE + 59_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('just now');
    });

    it('returns "Xm ago" for minutes', () => {
        mockNow(BASE + 5 * 60_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('5m ago');
    });

    it('returns "Xh ago" for hours', () => {
        mockNow(BASE + 3 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('3h ago');
    });

    it('returns "yesterday" for exactly 1 day ago', () => {
        mockNow(BASE + 24 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('yesterday');
    });

    it('returns "Xd ago" for 2-6 days ago', () => {
        mockNow(BASE + 3 * 24 * 3600_000);
        expect(formatRelativeTime(new Date(BASE).toISOString())).toBe('3d ago');
    });
});

describe('formatRelativeTime — future dates', () => {
    it('returns "just now" for ~0 seconds in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 30_000).toISOString(); // 30s ahead
        expect(formatRelativeTime(future)).toBe('just now');
    });

    it('returns "in Xm" for 5 minutes in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 5 * 60_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 5m');
    });

    it('returns "in Xm" for 55 minutes in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 55 * 60_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 55m');
    });

    it('returns "in Xh" for 2 hours in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 2 * 3600_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 2h');
    });

    it('returns "in Xd" for 3 days in the future', () => {
        mockNow(BASE);
        const future = new Date(BASE + 3 * 24 * 3600_000).toISOString();
        expect(formatRelativeTime(future)).toBe('in 3d');
    });
});

describe('formatRelativeTime — edge cases', () => {
    it('returns empty string for null', () => {
        expect(formatRelativeTime(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(formatRelativeTime(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(formatRelativeTime('')).toBe('');
    });
});

describe('formatConversationAsText', () => {
    it('returns empty string for empty turns array', () => {
        expect(formatConversationAsText([])).toBe('');
    });

    it('formats a basic user/assistant round-trip', () => {
        const turns = [
            { role: 'user' as const, content: 'Hello', toolCalls: [], timeline: [] },
            { role: 'assistant' as const, content: 'Hi there!', toolCalls: [], timeline: [] },
        ];
        expect(formatConversationAsText(turns)).toBe('[user]\nHello\n\n[assistant]\nHi there!');
    });

    it('includes tool calls with args and result', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Reading file',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'read_file',
                    args: { path: 'src/foo.ts' },
                    result: 'file content',
                    status: 'completed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('[tool: read_file]');
        expect(output).toContain('args: {"path":"src/foo.ts"}');
        expect(output).toContain('→ result: file content');
    });

    it('truncates tool call result longer than truncateAt', () => {
        const longResult = 'a'.repeat(150);
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Done',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'run_cmd',
                    args: {},
                    result: longResult,
                    status: 'completed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns, 100);
        expect(output).toContain('→ result: ' + 'a'.repeat(100) + '…');
        expect(output).not.toContain('a'.repeat(101));
    });

    it('truncates tool call args JSON longer than truncateAt', () => {
        const longPath = 'x'.repeat(200);
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Done',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'write_file',
                    args: { path: longPath },
                    result: 'ok',
                    status: 'completed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns, 100);
        const argsLine = output.split('\n').find(l => l.startsWith('[tool:'));
        expect(argsLine).toBeDefined();
        // args: ... portion should be truncated
        const argsMatch = argsLine!.match(/args: (.+?) →/);
        expect(argsMatch![1].length).toBeLessThanOrEqual(101); // 100 chars + '…'
    });

    it('omits result for pending/running tool calls', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Thinking',
                timeline: [],
                toolCalls: [
                    { id: '1', toolName: 'tool_a', args: {}, status: 'pending' as const },
                    { id: '2', toolName: 'tool_b', args: {}, status: 'running' as const },
                ],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('[tool: tool_a]');
        expect(output).not.toContain('→');
    });

    it('renders tool call error instead of result', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Oops',
                timeline: [],
                toolCalls: [{
                    id: '1',
                    toolName: 'write_file',
                    args: { path: 'x' },
                    error: 'File not found',
                    status: 'failed' as const,
                }],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('→ error: File not found');
    });

    it('uses .name field when .toolName is absent (snapshot replay path)', () => {
        const turns = [
            {
                role: 'assistant' as const,
                content: 'Searching',
                timeline: [],
                toolCalls: [{
                    name: 'grep',
                    args: { pattern: 'foo' },
                    result: 'bar',
                    status: 'completed' as const,
                }] as any[],
            },
        ];
        const output = formatConversationAsText(turns);
        expect(output).toContain('[tool: grep]');
        expect(output).not.toContain('undefined');
    });
});

describe('formatConversationAsHtml', () => {
    const identity = (c: string) => escapeHtml(c);

    it('returns empty string for empty turns', () => {
        expect(formatConversationAsHtml([], identity)).toBe('');
    });

    it('returns empty string for null/undefined turns', () => {
        expect(formatConversationAsHtml(null as any, identity)).toBe('');
        expect(formatConversationAsHtml(undefined as any, identity)).toBe('');
    });

    it('wraps output in a container div', () => {
        const turns = [{ role: 'user' as const, content: 'Hello' }];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toMatch(/^<div style="font-family:/);
        expect(html).toMatch(/<\/div>$/);
    });

    it('includes role badges for user and assistant', () => {
        const turns = [
            { role: 'user' as const, content: 'Hi' },
            { role: 'assistant' as const, content: 'Hello' },
        ];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toContain('>user<');
        expect(html).toContain('>assistant<');
    });

    it('calls contentToHtml for each turn content', () => {
        const converter = vi.fn((c: string) => `<b>${c}</b>`);
        const turns = [
            { role: 'user' as const, content: 'Question' },
            { role: 'assistant' as const, content: 'Answer' },
        ];
        formatConversationAsHtml(turns, converter);
        expect(converter).toHaveBeenCalledTimes(2);
        expect(converter).toHaveBeenCalledWith('Question');
        expect(converter).toHaveBeenCalledWith('Answer');
    });

    it('includes converted HTML content in output', () => {
        const converter = (c: string) => `<em>${c}</em>`;
        const turns = [{ role: 'user' as const, content: 'Test' }];
        const html = formatConversationAsHtml(turns, converter);
        expect(html).toContain('<em>Test</em>');
    });

    it('renders tool calls with name, args, and result', () => {
        const turns = [{
            role: 'assistant' as const,
            content: 'Done',
            toolCalls: [{
                toolName: 'read_file',
                args: { path: 'src/foo.ts' },
                result: 'file content here',
                status: 'completed',
            }],
        }];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toContain('read_file');
        expect(html).toContain('src/foo.ts');
        expect(html).toContain('result: file content here');
    });

    it('renders tool call errors', () => {
        const turns = [{
            role: 'assistant' as const,
            content: 'Oops',
            toolCalls: [{
                toolName: 'write_file',
                args: { path: 'x' },
                error: 'Permission denied',
                status: 'failed',
            }],
        }];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toContain('error: Permission denied');
    });

    it('shows status for pending/running tool calls', () => {
        const turns = [{
            role: 'assistant' as const,
            content: 'Working',
            toolCalls: [
                { toolName: 'tool_a', args: {}, status: 'pending' },
                { toolName: 'tool_b', args: {}, status: 'running' },
            ],
        }];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toContain('(pending)');
        expect(html).toContain('(running)');
        expect(html).not.toContain('result:');
    });

    it('truncates long tool call args and results', () => {
        const longStr = 'a'.repeat(300);
        const turns = [{
            role: 'assistant' as const,
            content: 'Done',
            toolCalls: [{
                toolName: 'run',
                args: { data: longStr },
                result: longStr,
                status: 'completed',
            }],
        }];
        const html = formatConversationAsHtml(turns, identity, 50);
        expect(html).not.toContain(longStr);
        expect(html).toContain('…');
    });

    it('uses .name field when .toolName is absent', () => {
        const turns = [{
            role: 'assistant' as const,
            content: 'Searching',
            toolCalls: [{
                name: 'grep',
                args: { pattern: 'foo' },
                result: 'bar',
                status: 'completed',
            }] as any[],
        }];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toContain('grep');
    });

    it('separates turns with <hr> elements', () => {
        const turns = [
            { role: 'user' as const, content: 'A' },
            { role: 'assistant' as const, content: 'B' },
        ];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toContain('<hr');
    });

    it('handles turns with empty content', () => {
        const turns = [
            { role: 'assistant' as const, content: '' },
        ];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).toContain('>assistant<');
    });

    it('escapes HTML in tool call names and args', () => {
        const turns = [{
            role: 'assistant' as const,
            content: 'test',
            toolCalls: [{
                toolName: '<script>alert(1)</script>',
                args: { key: '<img src=x>' },
                result: 'ok',
                status: 'completed',
            }],
        }];
        const html = formatConversationAsHtml(turns, identity);
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('<img src=x>');
        expect(html).toContain('&lt;script&gt;');
    });
});

// ---------------------------------------------------------------------------
// Inline-image selection copy (Ctrl+C → paste into Word / Google Docs / email)
// ---------------------------------------------------------------------------

/** Build a detached fragment holding an `img.chat-inline-image` between text. */
function makeImageFragment(attrs: Record<string, string>): DocumentFragment {
    const frag = document.createDocumentFragment();
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('before '));
    const img = document.createElement('img');
    img.className = 'chat-inline-image';
    for (const [k, v] of Object.entries(attrs)) img.setAttribute(k, v);
    p.appendChild(img);
    p.appendChild(document.createTextNode(' after'));
    frag.appendChild(p);
    return frag;
}

/** Read a Blob's text (jsdom Blob has no .text()). */
function readBlobText(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

/** A minimal Selection stand-in (jsdom's Selection.toString is unreliable). */
function stubSelection(fragment: DocumentFragment, text: string, opts: { rangeCount?: number; isCollapsed?: boolean } = {}): Selection {
    return {
        rangeCount: opts.rangeCount ?? 1,
        isCollapsed: opts.isCollapsed ?? false,
        getRangeAt: () => ({ cloneContents: () => fragment.cloneNode(true) }),
        toString: () => text,
    } as unknown as Selection;
}

describe('imageSrcToDataUri', () => {
    it('returns a base64 data URI for a fetchable same-origin proxy image', async () => {
        const blob = new Blob(['PNGBYTES'], { type: 'image/png' });
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }) as any;
        const uri = await imageSrcToDataUri('/api/workspaces/ws-1/files/image?path=a.png');
        expect(uri).toMatch(/^data:image\/png;base64,/);
    });

    it('passes an existing data: URI through unchanged without fetching', async () => {
        const fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy as any;
        const uri = await imageSrcToDataUri('data:image/png;base64,AAAA');
        expect(uri).toBe('data:image/png;base64,AAAA');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns null (never throws) when the fetch rejects — e.g. CORS', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('CORS')) as any;
        await expect(imageSrcToDataUri('https://example.com/x.png')).resolves.toBeNull();
    });

    it('returns null on a non-ok response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, blob: async () => new Blob([]) }) as any;
        await expect(imageSrcToDataUri('/api/img')).resolves.toBeNull();
    });

    it('returns null for an empty src', async () => {
        await expect(imageSrcToDataUri('')).resolves.toBeNull();
    });
});

describe('enrichSelectionHtmlWithInlineImages', () => {
    it('inlines a proxy-URL image as a data: URI and strips app-only attributes', async () => {
        const blob = new Blob(['PNGBYTES'], { type: 'image/png' });
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }) as any;
        const frag = makeImageFragment({
            src: '/api/workspaces/ws-1/files/image?path=a.png',
            loading: 'lazy',
            onerror: 'boom()',
            'data-local-path': 'a.png',
        });

        const html = await enrichSelectionHtmlWithInlineImages(frag);

        expect(html).toContain('data:image/png;base64,');
        expect(html).not.toContain('/api/workspaces');
        // App-only attributes are stripped from the emitted HTML.
        expect(html).not.toContain('chat-inline-image');
        expect(html).not.toContain('onerror');
        expect(html).not.toContain('data-local-path');
        expect(html).not.toContain('loading');
        // Surrounding text is preserved.
        expect(html).toContain('before ');
        expect(html).toContain(' after');
    });

    it('keeps the original absolute URL when a remote image cannot be fetched', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('CORS')) as any;
        const frag = makeImageFragment({ src: 'https://example.com/pic.png' });

        const html = await enrichSelectionHtmlWithInlineImages(frag);

        expect(html).toContain('https://example.com/pic.png');
        expect(html).not.toContain('data:');
    });

    it('does not mutate the passed fragment', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) }) as any;
        const frag = makeImageFragment({ src: '/api/img' });
        await enrichSelectionHtmlWithInlineImages(frag);
        const img = (frag.cloneNode(true) as DocumentFragment).querySelector('img');
        expect(img?.getAttribute('class')).toBe('chat-inline-image');
    });
});

describe('copySelectionWithInlineImages', () => {
    function installClipboard() {
        const write = vi.fn().mockResolvedValue(undefined);
        const items: any[] = [];
        // Capture ClipboardItem payloads so we can read the html flavor back.
        (globalThis as any).ClipboardItem = vi.fn(function (this: any, payload: Record<string, Blob>) {
            this.payload = payload;
            items.push(this);
        });
        Object.assign(navigator, { clipboard: { write } });
        return { write, items };
    }

    it('returns null and does nothing for a selection with no inline image', () => {
        const frag = document.createDocumentFragment();
        const p = document.createElement('p');
        p.textContent = 'just text';
        frag.appendChild(p);
        const setData = vi.fn();
        const preventDefault = vi.fn();

        const result = copySelectionWithInlineImages(
            stubSelection(frag, 'just text'),
            { setData } as unknown as DataTransfer,
            preventDefault,
        );

        expect(result).toBeNull();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(setData).not.toHaveBeenCalled();
    });

    it('returns null for an empty/collapsed selection', () => {
        const frag = makeImageFragment({ src: '/api/img' });
        const setData = vi.fn();
        const preventDefault = vi.fn();
        const result = copySelectionWithInlineImages(
            stubSelection(frag, '', { isCollapsed: true }),
            { setData } as unknown as DataTransfer,
            preventDefault,
        );
        expect(result).toBeNull();
        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('returns null for a null selection', () => {
        expect(copySelectionWithInlineImages(null, { setData: vi.fn() } as unknown as DataTransfer, vi.fn())).toBeNull();
    });

    it('prevents default, writes a sync fallback, then upgrades to inlined data-URI HTML', async () => {
        const { write, items } = installClipboard();
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['P'], { type: 'image/png' }) }) as any;
        const frag = makeImageFragment({ src: '/api/workspaces/ws-1/files/image?path=a.png' });
        const setData = vi.fn();
        const preventDefault = vi.fn();

        const result = copySelectionWithInlineImages(
            stubSelection(frag, 'before  after'),
            { setData } as unknown as DataTransfer,
            preventDefault,
        );
        expect(result).not.toBeNull();
        expect(preventDefault).toHaveBeenCalledTimes(1);

        // Synchronous best-effort fallback: original (un-inlined) HTML + text.
        const htmlCall = setData.mock.calls.find(c => c[0] === 'text/html');
        expect(htmlCall?.[1]).toContain('/api/workspaces');
        expect(setData).toHaveBeenCalledWith('text/plain', 'before  after');

        await result;

        // Async upgrade: clipboard.write got inlined data-URI HTML, no proxy URL.
        expect(write).toHaveBeenCalledTimes(1);
        const upgradedHtml = await readBlobText(items[0].payload['text/html']);
        expect(upgradedHtml).toContain('data:image/png;base64,');
        expect(upgradedHtml).not.toContain('/api/workspaces');
    });

    it('rejects the returned promise when the async clipboard write fails (caller catches)', async () => {
        const write = vi.fn().mockRejectedValue(new Error('denied'));
        (globalThis as any).ClipboardItem = vi.fn();
        Object.assign(navigator, { clipboard: { write } });
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['P'], { type: 'image/png' }) }) as any;
        const frag = makeImageFragment({ src: '/api/img' });

        const result = copySelectionWithInlineImages(
            stubSelection(frag, 'before  after'),
            { setData: vi.fn() } as unknown as DataTransfer,
            vi.fn(),
        );
        await expect(result).rejects.toThrow('denied');
    });
});
