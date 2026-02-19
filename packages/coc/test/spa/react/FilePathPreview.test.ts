/**
 * Regression tests for file path hover preview in React SPA.
 *
 * Ensures `.file-path-link` spans rendered from markdown still trigger
 * delegated hover previews after the React migration.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    workspaces: [{ id: 'ws-1', rootPath: '/Users/test/Documents/Projects/shortcuts' }],
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    path: fullPath,
                    fileName: 'app.ts',
                    lines: ['const value = 1;'],
                    totalLines: 1,
                    truncated: false,
                }),
            });

        vi.stubGlobal('fetch', fetchMock as any);

        await import('../../../src/server/spa/client/react/file-path-preview');

        const link = document.querySelector('.file-path-link') as HTMLElement;
        link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

        await vi.advanceTimersByTimeAsync(300);
        await Promise.resolve();
        await Promise.resolve();

        const tooltip = document.querySelector('.file-preview-tooltip') as HTMLElement | null;
        expect(tooltip).not.toBeNull();
        expect(tooltip?.textContent || '').toContain('app.ts');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/workspaces');
        expect(fetchMock.mock.calls[1]?.[0]).toContain('/api/workspaces/ws-1/files/preview');
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
