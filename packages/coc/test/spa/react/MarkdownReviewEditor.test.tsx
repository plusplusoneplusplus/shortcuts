/**
 * Tests for shared MarkdownReviewEditor rendering behavior.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MarkdownReviewEditor } from '../../../src/server/spa/client/react/shared/MarkdownReviewEditor';

function mockJsonResponse(body: any, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as any;
}

describe('MarkdownReviewEditor', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        (global as any).fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders markdown headings without status bar and without empty comment sidebar', async () => {
        fetchSpy.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tasks/content?')) {
                return Promise.resolve(mockJsonResponse({
                    content: '# Heading One\n## Heading Two\n\n```ts\nconst a = 1;\n```',
                }));
            }
            if (url.includes('/comment-counts/')) {
                return Promise.resolve(mockJsonResponse({ counts: {} }));
            }
            if (url.includes('/comments/')) {
                return Promise.resolve(mockJsonResponse({ comments: [] }));
            }
            return Promise.resolve(mockJsonResponse({}));
        });

        render(
            <MarkdownReviewEditor
                wsId="ws1"
                filePath="feature/example.md"
                fetchMode="tasks"
            />
        );

        await waitFor(() => {
            expect(document.querySelector('#task-preview-body .md-h1')).toBeTruthy();
        });

        expect(document.querySelector('#task-preview-body .md-h2')).toBeTruthy();
        expect(document.querySelector('#task-preview-body .code-block-container')).toBeTruthy();
        expect(screen.queryByTestId('markdown-review-status-bar')).toBeNull();
        expect(screen.queryByTestId('comment-sidebar')).toBeNull();
    });

    it('falls back to workspace file preview in auto mode', async () => {
        fetchSpy.mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tasks/content?')) {
                return Promise.resolve(mockJsonResponse({ error: 'not found' }, false, 404));
            }
            if (url.includes('/files/preview?') && url.includes('lines=0')) {
                return Promise.resolve(mockJsonResponse({
                    lines: ['# From Files API', 'Body line'],
                }));
            }
            if (url.includes('/comment-counts/')) {
                return Promise.resolve(mockJsonResponse({ counts: {} }));
            }
            if (url.includes('/comments/')) {
                return Promise.resolve(mockJsonResponse({ comments: [] }));
            }
            return Promise.resolve(mockJsonResponse({}));
        });

        render(
            <MarkdownReviewEditor
                wsId="ws1"
                filePath="/Users/test/project/README.md"
                fetchMode="auto"
            />
        );

        await waitFor(() => {
            expect(document.querySelector('#task-preview-body .md-h1')).toBeTruthy();
        });

        expect(fetchSpy).toHaveBeenCalledWith(
            expect.stringContaining('/files/preview?')
        );
    });
});
