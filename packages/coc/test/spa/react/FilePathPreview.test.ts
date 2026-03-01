/**
 * Regression tests for file path hover preview in React SPA.
 *
 * Ensures `.file-path-link` spans rendered from markdown still trigger
 * delegated hover previews after the React migration.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function mockWorkspaceAndPreview(fetchMock: ReturnType<typeof vi.fn>, overrides?: {
    fileName?: string;
    lines?: string[];
    totalLines?: number;
    truncated?: boolean;
}) {
    fetchMock
        .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                workspaces: [{ id: 'ws-1', rootPath: '/Users/test/Documents/Projects/shortcuts' }],
            }),
        })
        .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                path: '/Users/test/Documents/Projects/shortcuts/src/app.ts',
                fileName: overrides?.fileName ?? 'app.ts',
                lines: overrides?.lines ?? ['const value = 1;'],
                totalLines: overrides?.totalLines ?? 1,
                truncated: overrides?.truncated ?? false,
            }),
        });
}

async function hoverAndWait(link: HTMLElement) {
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    await Promise.resolve();
}

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
    return {
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
    } as DOMRect;
}

describe('file-path-preview delegation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        document.body.innerHTML = '';
        delete (window as any).__COC_FILE_PATH_PREVIEW_DELEGATION__;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('shows tooltip and fetches preview data on hover', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">shortcuts/src/app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock);
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');

        const link = document.querySelector('.file-path-link') as HTMLElement;
        await hoverAndWait(link);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement | null;
        expect(tooltip).not.toBeNull();
        expect(tooltip?.textContent || '').toContain('app.ts');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/workspaces');
        expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/workspaces/ws-1/files/preview');
    });

    it('renders row-based lines instead of legacy pre+join', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock, {
            lines: ['const a = 1;', 'const b = 2;', 'const c = 3;'],
            totalLines: 3,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

        const rows = document.querySelectorAll('.file-preview-line');
        expect(rows.length).toBe(3);

        expect(document.querySelector('pre.file-preview-code')).toBeNull();
        expect(document.querySelector('.file-preview-lines')).not.toBeNull();
    });

    it('renders line numbers aligned with each row', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock, {
            lines: ['line one', 'line two', 'line three'],
            totalLines: 3,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

        const lineNumbers = document.querySelectorAll('.file-preview-line-number');
        expect(lineNumbers.length).toBe(3);
        expect(lineNumbers[0].textContent).toBe('1');
        expect(lineNumbers[1].textContent).toBe('2');
        expect(lineNumbers[2].textContent).toBe('3');

        // Each number is a sibling of line content in the same row
        for (const num of lineNumbers) {
            const row = num.parentElement;
            expect(row?.classList.contains('file-preview-line')).toBe(true);
            expect(row?.querySelector('.file-preview-line-content')).not.toBeNull();
        }
    });

    it('line content supports word wrap via CSS classes', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock, {
            lines: ['a very long line that should eventually wrap in the tooltip container'],
            totalLines: 1,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

        const content = document.querySelector('.file-preview-line-content') as HTMLElement;
        expect(content).not.toBeNull();
        expect(content.className).toBe('file-preview-line-content');
    });

    it('handles empty lines without collapsing rows', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock, {
            lines: ['first', '', 'third'],
            totalLines: 3,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

        const rows = document.querySelectorAll('.file-preview-line');
        expect(rows.length).toBe(3);

        // Empty line should contain zero-width space to prevent row collapse
        const emptyContent = rows[1].querySelector('.file-preview-line-content');
        expect(emptyContent?.textContent).toBe('\u200B');
    });

    it('shows truncation info when file is truncated', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock, {
            lines: ['line 1'],
            totalLines: 250,
            truncated: true,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip.textContent).toContain('250 total');
    });

    it('dispatches markdown review open event on click', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/.vscode/tasks/sample.md';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">sample.md</span>
            </div>
        `;

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ workspaces: [] }),
        }) as any);

        await import('../../../src/server/spa/client/react/file-path-preview');

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

        const link = document.querySelector('.file-path-link') as HTMLElement;
        link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'coc-open-markdown-review',
                detail: { filePath: fullPath },
            })
        );
    });

    it('positions tooltip using measured dimensions instead of hardcoded size', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock);
        vi.stubGlobal('fetch', fetchMock as any);

        const originalInnerWidth = window.innerWidth;
        const originalInnerHeight = window.innerHeight;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

        try {
            const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
            rectSpy.mockImplementation(function(this: HTMLElement): DOMRect {
                if (this.classList?.contains('file-path-link')) {
                    return makeRect(780, 120, 200, 22);
                }
                if (this.classList?.contains('file-preview-tooltip')) {
                    return makeRect(0, 0, 820, 320);
                }
                return makeRect(0, 0, 0, 0);
            });

            await import('../../../src/server/spa/client/react/file-path-preview');
            await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

            const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
            expect(tooltip.style.left).toBe('164px');
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
            Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
        }
    });
});

function mockWorkspaceAndDirectoryPreview(fetchMock: ReturnType<typeof vi.fn>, overrides?: {
    dirName?: string;
    entries?: { name: string; isDirectory: boolean }[];
    totalEntries?: number;
    truncated?: boolean;
}) {
    // Use URL-based routing to handle accumulated event listeners from prior test imports
    fetchMock.mockImplementation((url: string) => {
        if (url.includes('/files/preview')) {
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    type: 'directory',
                    path: '/Users/test/Documents/Projects/shortcuts/src',
                    dirName: overrides?.dirName ?? 'src',
                    entries: overrides?.entries ?? [
                        { name: 'components', isDirectory: true },
                        { name: 'index.ts', isDirectory: false },
                    ],
                    totalEntries: overrides?.totalEntries ?? 2,
                    truncated: overrides?.truncated ?? false,
                }),
            });
        }
        return Promise.resolve({
            ok: true,
            json: async () => ({
                workspaces: [{ id: 'ws-1', rootPath: '/Users/test/Documents/Projects/shortcuts' }],
            }),
        });
    });
}

async function hoverAndWaitForDirectory(link: HTMLElement) {
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    // Directory rendering requires extra microtask flushes for the promise chain
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('directory hover preview', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        document.body.innerHTML = '';
        delete (window as any).__COC_FILE_PATH_PREVIEW_DELEGATION__;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('renders directory entry list with icons', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">src</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndDirectoryPreview(fetchMock, {
            dirName: 'src',
            entries: [
                { name: 'components', isDirectory: true },
                { name: 'utils', isDirectory: true },
                { name: 'app.ts', isDirectory: false },
            ],
            totalEntries: 3,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        const link = document.querySelector('.file-path-link') as HTMLElement;
        await hoverAndWaitForDirectory(link);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip).not.toBeNull();

        const entries = document.querySelectorAll('.file-preview-dir-entry');
        expect(entries.length).toBe(3);

        const icons = document.querySelectorAll('.file-preview-dir-icon');
        expect(icons[0].textContent).toBe('\uD83D\uDCC1');
        expect(icons[1].textContent).toBe('\uD83D\uDCC1');
        expect(icons[2].textContent).toBe('\uD83D\uDCC4');
    });

    it('shows summary line with folder and file counts', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">src</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndDirectoryPreview(fetchMock, {
            entries: [
                { name: 'dir1', isDirectory: true },
                { name: 'dir2', isDirectory: true },
                { name: 'dir3', isDirectory: true },
                { name: 'a.ts', isDirectory: false },
                { name: 'b.ts', isDirectory: false },
            ],
            totalEntries: 5,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWaitForDirectory(document.querySelector('.file-path-link') as HTMLElement);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip.textContent).toContain('3 folders, 2 files');
    });

    it('shows truncation indicator for large directories', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">src</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndDirectoryPreview(fetchMock, {
            entries: [{ name: 'a.ts', isDirectory: false }],
            totalEntries: 47,
            truncated: true,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWaitForDirectory(document.querySelector('.file-path-link') as HTMLElement);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip.textContent).toContain('47 total');
    });

    it('shows singular form for 1 folder, 1 file', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">src</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndDirectoryPreview(fetchMock, {
            entries: [
                { name: 'sub', isDirectory: true },
                { name: 'index.ts', isDirectory: false },
            ],
            totalEntries: 2,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWaitForDirectory(document.querySelector('.file-path-link') as HTMLElement);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip.textContent).toContain('1 folder, 1 file');
    });
});

describe('tooltip scroll behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        document.body.innerHTML = '';
        delete (window as any).__COC_FILE_PATH_PREVIEW_DELEGATION__;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('stops wheel event propagation on tooltip', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">src</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndDirectoryPreview(fetchMock, {
            entries: Array.from({ length: 20 }, (_, i) => ({
                name: `file${i}.ts`,
                isDirectory: false,
            })),
            totalEntries: 20,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWaitForDirectory(document.querySelector('.file-path-link') as HTMLElement);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip).not.toBeNull();

        const wheelEvent = new WheelEvent('wheel', { bubbles: true, cancelable: true });
        const stopSpy = vi.spyOn(wheelEvent, 'stopPropagation');
        tooltip.dispatchEvent(wheelEvent);

        expect(stopSpy).toHaveBeenCalled();
    });

    it('keeps tooltip visible while scroll activity is ongoing', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">src</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndDirectoryPreview(fetchMock, {
            entries: Array.from({ length: 20 }, (_, i) => ({
                name: `file${i}.ts`,
                isDirectory: false,
            })),
            totalEntries: 20,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWaitForDirectory(document.querySelector('.file-path-link') as HTMLElement);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip.style.display).toBe('block');

        // Simulate scroll on tooltip body (capture phase listener)
        const body = tooltip.querySelector('.file-preview-tooltip-body') as HTMLElement;
        body.dispatchEvent(new Event('scroll', { bubbles: true }));

        // Now fire mouseleave — tooltip should remain visible because isScrollingTooltip is true
        tooltip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

        // Advance past the hide delay (200ms) — tooltip should still be visible
        await vi.advanceTimersByTimeAsync(250);
        expect(tooltip.style.display).toBe('block');

        // Advance past the scrollEnd timer (150ms) — then the deferred hide kicks in
        await vi.advanceTimersByTimeAsync(200);
        expect(tooltip.style.display).toBe('none');
    });

    it('body scroll guard handles non-bubbling scroll events (real browser behavior)', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">src</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndDirectoryPreview(fetchMock, {
            entries: Array.from({ length: 20 }, (_, i) => ({
                name: `file${i}.ts`,
                isDirectory: false,
            })),
            totalEntries: 20,
        });
        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');
        await hoverAndWaitForDirectory(document.querySelector('.file-path-link') as HTMLElement);

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
        expect(tooltip.style.display).toBe('block');

        // Dispatch non-bubbling scroll (matches real browser behavior)
        const body = tooltip.querySelector('.file-preview-tooltip-body') as HTMLElement;
        body.dispatchEvent(new Event('scroll', { bubbles: false }));

        // mouseleave should not dismiss while scrolling
        tooltip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(250);
        expect(tooltip.style.display).toBe('block');

        // After scroll-end timer, tooltip hides
        await vi.advanceTimersByTimeAsync(200);
        expect(tooltip.style.display).toBe('none');
    });
});

describe('tooltip dynamic max-height clamping', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        document.body.innerHTML = '';
        delete (window as any).__COC_FILE_PATH_PREVIEW_DELEGATION__;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('sets maxHeight based on available viewport space below trigger', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock);
        vi.stubGlobal('fetch', fetchMock as any);

        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

        try {
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement): DOMRect {
                if (this.classList?.contains('file-path-link')) {
                    // Trigger near top: plenty of space below
                    return makeRect(100, 50, 200, 20);
                }
                if (this.classList?.contains('file-preview-tooltip')) {
                    return makeRect(0, 0, 600, 300);
                }
                return makeRect(0, 0, 0, 0);
            });

            await import('../../../src/server/spa/client/react/file-path-preview');
            await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

            const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
            // top = 50 + 20 + 6 = 76; available = 800 - 76 - 16 = 708; clamped to 560
            expect(tooltip.style.maxHeight).toBe('560px');
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
            Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
        }
    });

    it('clamps maxHeight to remaining space when trigger is near bottom', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock);
        vi.stubGlobal('fetch', fetchMock as any);

        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });

        try {
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement): DOMRect {
                if (this.classList?.contains('file-path-link')) {
                    // Trigger near bottom: limited space below, tooltip repositions above
                    return makeRect(100, 500, 200, 20);
                }
                if (this.classList?.contains('file-preview-tooltip')) {
                    return makeRect(0, 0, 600, 400);
                }
                return makeRect(0, 0, 0, 0);
            });

            await import('../../../src/server/spa/client/react/file-path-preview');
            await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

            const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
            const maxH = parseInt(tooltip.style.maxHeight, 10);
            // Should be clamped, not the full 560px default
            expect(maxH).toBeGreaterThanOrEqual(80);
            expect(maxH).toBeLessThanOrEqual(560);
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
            Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
        }
    });

    it('enforces minimum maxHeight of 80px even in tight viewport', async () => {
        const fullPath = '/Users/test/Documents/Projects/shortcuts/src/app.ts';
        document.body.innerHTML = `
            <div>
                <span class="file-path-link" data-full-path="${fullPath}">app.ts</span>
            </div>
        `;

        const fetchMock = vi.fn();
        mockWorkspaceAndPreview(fetchMock);
        vi.stubGlobal('fetch', fetchMock as any);

        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 });

        try {
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement): DOMRect {
                if (this.classList?.contains('file-path-link')) {
                    return makeRect(100, 50, 200, 20);
                }
                if (this.classList?.contains('file-preview-tooltip')) {
                    return makeRect(0, 0, 600, 80);
                }
                return makeRect(0, 0, 0, 0);
            });

            await import('../../../src/server/spa/client/react/file-path-preview');
            await hoverAndWait(document.querySelector('.file-path-link') as HTMLElement);

            const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement;
            expect(parseInt(tooltip.style.maxHeight, 10)).toBeGreaterThanOrEqual(80);
        } finally {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
            Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
        }
    });
});

describe('file-preview-tooltip CSS rules', () => {
    const cssPath = resolve(__dirname, '../../../src/server/spa/client/tailwind.css');
    const css = readFileSync(cssPath, 'utf-8');

    function extractBlock(selector: string): string {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped + '\\s*\\{([^}]+)\\}');
        const m = css.match(re);
        return m ? m[1] : '';
    }

    it('uses responsive 80vw width', () => {
        const block = extractBlock('.file-preview-tooltip');
        expect(block).toContain('width: min(80vw, 960px)');
    });

    it('uses responsive max height to avoid viewport overflow', () => {
        const block = extractBlock('.file-preview-tooltip');
        expect(block).toContain('max-height: min(75vh, 560px)');
    });

    it('tooltip body has min-height: 0 for flex scroll containment', () => {
        const block = extractBlock('.file-preview-tooltip-body');
        expect(block).toContain('min-height: 0');
    });

    it('tooltip has min-height for small directories', () => {
        const block = extractBlock('.file-preview-tooltip');
        expect(block).toContain('min-height: 80px');
    });
});
