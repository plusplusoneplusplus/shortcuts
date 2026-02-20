/**
 * Regression tests for file path hover preview in React SPA.
 *
 * Ensures `.file-path-link` spans rendered from markdown still trigger
 * delegated hover previews after the React migration.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
