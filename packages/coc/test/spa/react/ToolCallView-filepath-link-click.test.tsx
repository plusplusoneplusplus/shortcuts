/**
 * Regression test: clicking a file-path-link inside the tool-call-header should
 * NOT expand/collapse the card (the card should stay collapsed).
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

function makeToolCallWithPath(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-path-1',
        toolName: 'view',
        args: { path: '/home/user/project/src/index.ts' },
        status: 'completed',
        result: '1. const x = 1;',
        ...overrides,
    };
}

function getBody(container: HTMLElement) {
    return container.querySelector('.tool-call-body');
}

describe('ToolCallView — file-path-link click does not toggle card', () => {
    it('clicking the file-path-link in the header does not expand the card', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCallWithPath()} />
        );

        // Card should start collapsed
        const bodyBefore = getBody(container);
        const isCollapsedBefore = !bodyBefore || bodyBefore.classList.contains('hidden');
        expect(isCollapsedBefore).toBe(true);

        // Click the file-path-link span (the summary path shown in the header)
        const pathLink = container.querySelector('.tool-call-header .file-path-link');
        expect(pathLink).toBeTruthy();
        fireEvent.click(pathLink!);

        // Card should still be collapsed after clicking the link
        const bodyAfter = getBody(container);
        const isStillCollapsed = !bodyAfter || bodyAfter.classList.contains('hidden');
        expect(isStillCollapsed).toBe(true);
    });

    it('clicking elsewhere in the header still expands the card', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCallWithPath()} />
        );

        // Click directly on the header (not on a file-path-link)
        const header = container.querySelector('.tool-call-header');
        expect(header).toBeTruthy();
        fireEvent.click(header!);

        // Card should now be expanded
        const body = getBody(container);
        expect(body).toBeTruthy();
        expect(body!.classList.contains('hidden')).toBe(false);
    });
});
