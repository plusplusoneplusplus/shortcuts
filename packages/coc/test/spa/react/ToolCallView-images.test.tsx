/**
 * Tests for ToolCallView — image data URL detection in tool results.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/processes/ToolCallView';

function makeToolCall(overrides: Record<string, any> = {}) {
    return {
        id: 'tc-1',
        toolName: 'test_tool',
        args: {},
        status: 'completed',
        ...overrides,
    };
}

function expandToolCall(container: HTMLElement) {
    const header = container.querySelector('.tool-call-header');
    if (header) fireEvent.click(header);
}

describe('ToolCallView — image result rendering', () => {
    it('renders an img tag when result is an image data URL', () => {
        const imgDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA';
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ result: imgDataUrl })} />
        );
        expandToolCall(container);

        const img = screen.queryByTestId('tool-result-image');
        expect(img).toBeTruthy();
        expect(img?.getAttribute('src')).toBe(imgDataUrl);
        expect(img?.getAttribute('alt')).toBe('Tool result image');
    });

    it('renders a pre block when result is plain text', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ result: 'Hello world output', args: undefined })} />
        );
        expandToolCall(container);

        expect(screen.queryByTestId('tool-result-image')).toBeNull();
        const pre = container.querySelector('pre code');
        expect(pre?.textContent).toContain('Hello world output');
    });

    it('detects jpeg image data URLs', () => {
        const imgDataUrl = 'data:image/jpeg;base64,/9j/4AAQ';
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ result: imgDataUrl })} />
        );
        expandToolCall(container);

        expect(screen.queryByTestId('tool-result-image')).toBeTruthy();
    });

    it('detects webp image data URLs', () => {
        const imgDataUrl = 'data:image/webp;base64,UklGRh4A';
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ result: imgDataUrl })} />
        );
        expandToolCall(container);

        expect(screen.queryByTestId('tool-result-image')).toBeTruthy();
    });

    it('does not treat non-image data URLs as images', () => {
        const { container } = render(
            <ToolCallView toolCall={makeToolCall({ result: 'data:text/plain;base64,aGVsbG8=' })} />
        );
        expandToolCall(container);

        expect(screen.queryByTestId('tool-result-image')).toBeNull();
    });
});
