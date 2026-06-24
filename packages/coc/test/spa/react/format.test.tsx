import { describe, it, expect, vi } from 'vitest';
import { formatDuration, formatRelativeTime, escapeHtml, copyToClipboard, copyImageToClipboard, statusIcon, statusLabel, typeLabel, repoName } from '../../../src/server/spa/client/react/utils/format';

describe('formatDuration', () => {
    it('returns empty string for null', () => {
        expect(formatDuration(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(formatDuration(undefined)).toBe('');
    });

    it('returns empty string for negative', () => {
        expect(formatDuration(-100)).toBe('');
    });

    it('returns "< 1s" for 0ms', () => {
        expect(formatDuration(0)).toBe('< 1s');
    });

    it('returns "< 1s" for sub-second values', () => {
        expect(formatDuration(500)).toBe('< 1s');
        expect(formatDuration(999)).toBe('< 1s');
    });

    it('formats seconds', () => {
        expect(formatDuration(1000)).toBe('1s');
        expect(formatDuration(30000)).toBe('30s');
        expect(formatDuration(59000)).toBe('59s');
    });

    it('formats minutes and seconds', () => {
        expect(formatDuration(60000)).toBe('1m 0s');
        expect(formatDuration(90000)).toBe('1m 30s');
        expect(formatDuration(3599000)).toBe('59m 59s');
    });

    it('formats hours and minutes', () => {
        expect(formatDuration(3600000)).toBe('1h 0m');
        expect(formatDuration(5400000)).toBe('1h 30m');
        expect(formatDuration(7200000)).toBe('2h 0m');
    });
});

describe('formatRelativeTime', () => {
    it('returns empty string for null', () => {
        expect(formatRelativeTime(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(formatRelativeTime(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(formatRelativeTime('')).toBe('');
    });

    it('returns "just now" for recent timestamps', () => {
        const now = new Date();
        expect(formatRelativeTime(now.toISOString())).toBe('just now');
    });

    it('returns minutes ago', () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
        expect(formatRelativeTime(fiveMinAgo.toISOString())).toBe('5m ago');
    });

    it('returns hours ago', () => {
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        expect(formatRelativeTime(twoHoursAgo.toISOString())).toBe('2h ago');
    });

    it('returns "yesterday" for 1 day ago', () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        expect(formatRelativeTime(yesterday.toISOString())).toBe('yesterday');
    });

    it('returns days ago for 2-6 days', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        expect(formatRelativeTime(threeDaysAgo.toISOString())).toBe('3d ago');
    });

    it('returns locale date string for 7+ days', () => {
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        const result = formatRelativeTime(tenDaysAgo.toISOString());
        // Should be a locale date string, not relative
        expect(result).not.toContain('ago');
        expect(result).not.toBe('');
    });
});

describe('escapeHtml', () => {
    it('returns empty string for null', () => {
        expect(escapeHtml(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(escapeHtml(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('passes through plain text', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('escapes ampersand', () => {
        expect(escapeHtml('a&b')).toBe('a&amp;b');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('escapes multiple special characters', () => {
        expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
    });
});

describe('copyToClipboard', () => {
    it('uses navigator.clipboard when available', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true,
        });
        await copyToClipboard('test');
        expect(writeText).toHaveBeenCalledWith('test');
    });
});

describe('copyImageToClipboard', () => {
    it('writes a PNG data URL directly to the clipboard', async () => {
        const pngBlob = new Blob(['png-bytes'], { type: 'image/png' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: async () => pngBlob }));
        const items: any[] = [];
        class FakeClipboardItem {
            constructor(public data: Record<string, any>) {}
        }
        vi.stubGlobal('ClipboardItem', FakeClipboardItem as any);
        const write = vi.fn(async (arr: any[]) => { items.push(...arr); });
        Object.defineProperty(navigator, 'clipboard', {
            value: { write },
            writable: true,
            configurable: true,
        });

        await copyImageToClipboard('data:image/png;base64,AAAA');

        expect(write).toHaveBeenCalledTimes(1);
        expect(items[0]).toBeInstanceOf(FakeClipboardItem);
        // The PNG blob promise resolves to the original blob (no re-encode).
        await expect(items[0].data['image/png']).resolves.toBe(pngBlob);
        vi.unstubAllGlobals();
    });

    it('throws when ClipboardItem is unavailable', async () => {
        vi.stubGlobal('ClipboardItem', undefined as any);
        await expect(copyImageToClipboard('data:image/png;base64,AAAA')).rejects.toThrow();
        vi.unstubAllGlobals();
    });

    it('throws when navigator.clipboard.write is unavailable', async () => {
        class FakeClipboardItem { constructor(public data: Record<string, any>) {} }
        vi.stubGlobal('ClipboardItem', FakeClipboardItem as any);
        Object.defineProperty(navigator, 'clipboard', {
            value: {},
            writable: true,
            configurable: true,
        });
        await expect(copyImageToClipboard('data:image/png;base64,AAAA')).rejects.toThrow();
        vi.unstubAllGlobals();
    });
});

describe('statusIcon', () => {
    it('returns icon for known statuses', () => {
        expect(statusIcon('running')).toBe('🔄');
        expect(statusIcon('completed')).toBe('✅');
        expect(statusIcon('failed')).toBe('❌');
        expect(statusIcon('cancelled')).toBe('🚫');
        expect(statusIcon('queued')).toBe('⏳');
    });

    it('returns empty string for unknown status', () => {
        expect(statusIcon('unknown')).toBe('');
    });
});

describe('statusLabel', () => {
    it('returns label for known statuses', () => {
        expect(statusLabel('running')).toBe('Thinking');
        expect(statusLabel('completed')).toBe('Completed');
        expect(statusLabel('failed')).toBe('Failed');
    });

    it('returns the status string for unknown status', () => {
        expect(statusLabel('custom')).toBe('custom');
    });

    it('returns empty string for empty status', () => {
        expect(statusLabel('')).toBe('');
    });

    it('returns Running for non-chat types when running', () => {
        expect(statusLabel('running', 'pipeline')).toBe('Running');
        expect(statusLabel('running', 'workflow')).toBe('Running');
        expect(statusLabel('running', 'script')).toBe('Running');
    });

    it('returns Thinking for chat type when running', () => {
        expect(statusLabel('running', 'chat')).toBe('Thinking');
    });

    it('returns Thinking when type is omitted and running', () => {
        expect(statusLabel('running')).toBe('Thinking');
        expect(statusLabel('running', undefined)).toBe('Thinking');
    });

    it('type param does not affect non-running statuses', () => {
        expect(statusLabel('completed', 'pipeline')).toBe('Completed');
        expect(statusLabel('failed', 'workflow')).toBe('Failed');
        expect(statusLabel('queued', 'script')).toBe('Queued');
    });
});

describe('typeLabel', () => {
    it('returns label for known types', () => {
        expect(typeLabel('code-review')).toBe('Code Review');
        expect(typeLabel('pipeline-execution')).toBe('Workflow');
    });

    it('returns the type string for unknown type', () => {
        expect(typeLabel('custom')).toBe('custom');
    });
});

describe('repoName', () => {
    it('returns empty string for null', () => {
        expect(repoName(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
        expect(repoName(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
        expect(repoName('')).toBe('');
    });

    it('extracts basename from Unix absolute path', () => {
        expect(repoName('/Users/dev/projects/my-repo')).toBe('my-repo');
    });

    it('extracts basename from path with trailing slash', () => {
        expect(repoName('/Users/dev/projects/my-repo/')).toBe('my-repo');
    });

    it('extracts basename from path with multiple trailing slashes', () => {
        expect(repoName('/Users/dev/projects/my-repo///')).toBe('my-repo');
    });

    it('extracts basename from Windows-style forward-slash path', () => {
        expect(repoName('C:/Users/dev/projects/my-repo')).toBe('my-repo');
    });

    it('returns the string itself when no slash present', () => {
        expect(repoName('my-repo')).toBe('my-repo');
    });

    it('handles single segment with leading slash', () => {
        expect(repoName('/root')).toBe('root');
    });

    it('handles deeply nested paths', () => {
        expect(repoName('/a/b/c/d/e/repo-name')).toBe('repo-name');
    });

    it('extracts basename from Windows backslash path', () => {
        expect(repoName('D:\\projects\\shortcuts')).toBe('shortcuts');
    });

    it('extracts basename from Windows backslash path with trailing backslash', () => {
        expect(repoName('D:\\projects\\shortcuts\\')).toBe('shortcuts');
    });

    it('extracts basename from Windows backslash path with multiple trailing backslashes', () => {
        expect(repoName('D:\\projects\\shortcuts\\\\\\')).toBe('shortcuts');
    });

    it('extracts basename from Windows drive root with backslash', () => {
        expect(repoName('C:\\repo')).toBe('repo');
    });

    it('extracts basename from deeply nested Windows backslash path', () => {
        expect(repoName('C:\\Users\\dev\\projects\\my-repo')).toBe('my-repo');
    });

    it('handles mixed forward and backslash separators', () => {
        expect(repoName('C:\\Users/dev\\projects/my-repo')).toBe('my-repo');
    });

    it('handles mixed separators with trailing slashes', () => {
        expect(repoName('C:\\Users/dev\\repo/')).toBe('repo');
        expect(repoName('C:/Users\\dev/repo\\')).toBe('repo');
    });
});
