/**
 * Tests for ToolCallView — file paths in tool call views use noTruncate
 * and the collapsed summary span uses break-all instead of truncate.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/chat/ToolCallView';

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

function getBody(container: HTMLElement) {
    return container.querySelector('.tool-call-body');
}

describe('ToolCallView — noTruncate file paths in expanded views', () => {
    it('edit tool: FilePathLink has break-all and no truncate', () => {
        const tc = {
            id: 'tc-edit',
            toolName: 'edit',
            args: { path: '/very/long/deeply/nested/project/src/components/feature/module/file.ts', old_str: 'a', new_str: 'b' },
            status: 'completed',
            result: 'ok',
        };
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);

        const body = getBody(container)!;
        const fpLink = body.querySelector('.file-path-link');
        expect(fpLink).toBeTruthy();
        expect(fpLink!.className).toContain('break-all');
        expect(fpLink!.className).not.toContain('truncate');
        expect(fpLink!.className).not.toContain('max-w-[260px]');
    });

    it('create tool: FilePathLink has break-all and no truncate', () => {
        const tc = {
            id: 'tc-create',
            toolName: 'create',
            args: { path: '/very/long/deeply/nested/project/src/components/feature/module/new-file.ts', file_text: 'hello' },
            status: 'completed',
            result: 'ok',
        };
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);

        const body = getBody(container)!;
        const fpLink = body.querySelector('.file-path-link');
        expect(fpLink).toBeTruthy();
        expect(fpLink!.className).toContain('break-all');
        expect(fpLink!.className).not.toContain('truncate');
    });

    it('view tool (text result): FilePathLink has break-all and no truncate', () => {
        const tc = {
            id: 'tc-view',
            toolName: 'view',
            args: { path: '/very/long/deeply/nested/project/src/components/feature/module/view-file.ts' },
            status: 'completed',
            result: '1. const x = 1;',
        };
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);

        const body = getBody(container)!;
        const fpLink = body.querySelector('.file-path-link');
        expect(fpLink).toBeTruthy();
        expect(fpLink!.className).toContain('break-all');
        expect(fpLink!.className).not.toContain('truncate');
    });

    it('view tool (image result): FilePathLink has break-all and no truncate', () => {
        const tc = {
            id: 'tc-view-img',
            toolName: 'view',
            args: { path: '/very/long/deeply/nested/project/src/assets/screenshot.png' },
            status: 'completed',
            result: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
        };
        const { container } = render(<ToolCallView toolCall={tc} />);
        expandToolCall(container);

        const body = getBody(container)!;
        const fpLink = body.querySelector('.file-path-link');
        expect(fpLink).toBeTruthy();
        expect(fpLink!.className).toContain('break-all');
        expect(fpLink!.className).not.toContain('truncate');
    });
});

describe('ToolCallView — collapsed summary uses break-all', () => {
    it('summary span has break-all and no truncate class', () => {
        const tc = {
            id: 'tc-edit-summary',
            toolName: 'edit',
            args: { path: '/very/long/deeply/nested/project/src/components/feature/module/file.ts', old_str: 'a', new_str: 'b' },
            status: 'completed',
            result: 'ok',
        };
        const { container } = render(<ToolCallView toolCall={tc} />);

        // The summary span in the header (collapsed state)
        const header = container.querySelector('.tool-call-header')!;
        const summarySpans = header.querySelectorAll('span');
        // Find the summary span — it has the text-[#848484] and min-w-0 classes
        const summarySpan = Array.from(summarySpans).find(
            s => s.className.includes('min-w-0')
        );
        expect(summarySpan).toBeTruthy();
        expect(summarySpan!.className).toContain('break-all');
        expect(summarySpan!.className).not.toContain('truncate');
    });
});
