/**
 * Tests for FilePathLink integration in ToolCallView and QueueTaskDetail.
 * Verifies that `.file-path-link` spans are rendered in the right places.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

vi.mock('../../../src/server/spa/client/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

describe('ToolCallView — file-path-link integration', () => {
    describe('header summary', () => {
        it('renders file-path-link class on summary for edit tool', () => {
            const { container } = render(
                <ToolCallView toolCall={{
                    id: 'tc-1',
                    toolName: 'edit',
                    args: { path: '/Users/alice/code/app.ts', old_str: 'a', new_str: 'b' },
                    status: 'completed',
                }} />
            );
            const header = container.querySelector('.tool-call-header');
            const link = header?.querySelector('.file-path-link');
            expect(link).not.toBeNull();
            expect(link?.getAttribute('data-full-path')).toBe('/Users/alice/code/app.ts');
        });

        it('renders file-path-link class on summary for view tool', () => {
            const { container } = render(
                <ToolCallView toolCall={{
                    id: 'tc-2',
                    toolName: 'view',
                    args: { path: '/home/bob/project/main.ts' },
                    status: 'completed',
                    result: '1. hello',
                }} />
            );
            const header = container.querySelector('.tool-call-header');
            const link = header?.querySelector('.file-path-link');
            expect(link).not.toBeNull();
            expect(link?.getAttribute('data-full-path')).toBe('/home/bob/project/main.ts');
        });

        it('renders file-path-link class on summary for create tool', () => {
            const { container } = render(
                <ToolCallView toolCall={{
                    id: 'tc-3',
                    toolName: 'create',
                    args: { path: '/tmp/new-file.ts', file_text: 'hello' },
                    status: 'completed',
                }} />
            );
            const header = container.querySelector('.tool-call-header');
            const link = header?.querySelector('.file-path-link');
            expect(link).not.toBeNull();
        });

        it('does NOT render file-path-link on summary for bash tool', () => {
            const { container } = render(
                <ToolCallView toolCall={{
                    id: 'tc-4',
                    toolName: 'bash',
                    args: { command: 'ls -la' },
                    status: 'completed',
                    result: 'output',
                }} />
            );
            const header = container.querySelector('.tool-call-header');
            const link = header?.querySelector('.file-path-link');
            expect(link).toBeNull();
        });
    });

    describe('expanded body', () => {
        it('renders FilePathLink in EditToolView body', () => {
            const { container } = render(
                <ToolCallView toolCall={{
                    id: 'tc-5',
                    toolName: 'edit',
                    args: { path: '/Users/alice/code/app.ts', old_str: 'old', new_str: 'new' },
                    status: 'completed',
                }} />
            );
            expandToolCall(container);
            const body = container.querySelector('.tool-call-body');
            const link = body?.querySelector('.file-path-link');
            expect(link).not.toBeNull();
            expect(link?.getAttribute('data-full-path')).toBe('/Users/alice/code/app.ts');
            expect(link?.textContent).toBe('~/code/app.ts');
        });

        it('renders FilePathLink in CreateToolView body', () => {
            const { container } = render(
                <ToolCallView toolCall={{
                    id: 'tc-6',
                    toolName: 'create',
                    args: { path: '/home/bob/project/new.ts', file_text: 'content' },
                    status: 'completed',
                }} />
            );
            expandToolCall(container);
            const body = container.querySelector('.tool-call-body');
            const link = body?.querySelector('.file-path-link');
            expect(link).not.toBeNull();
            expect(link?.getAttribute('data-full-path')).toBe('/home/bob/project/new.ts');
        });

        it('renders FilePathLink in ViewToolView body', () => {
            const { container } = render(
                <ToolCallView toolCall={{
                    id: 'tc-7',
                    toolName: 'view',
                    args: { path: '/Users/alice/Documents/Projects/repo/src/main.ts' },
                    status: 'completed',
                    result: '1. const x = 1;',
                }} />
            );
            expandToolCall(container);
            const body = container.querySelector('.tool-call-body');
            const link = body?.querySelector('.file-path-link');
            expect(link).not.toBeNull();
            expect(link?.textContent).toBe('repo/src/main.ts');
        });
    });
});
