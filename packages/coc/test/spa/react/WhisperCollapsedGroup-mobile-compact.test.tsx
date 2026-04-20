/**
 * Tests for WhisperCollapsedGroup mobile compaction:
 * - Tighter header button padding
 * - Tighter expanded body padding and spacing
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/chat/WhisperCollapsedGroup';
import { mockViewport } from '../helpers/viewport-mock';

let viewportCleanup: (() => void) | undefined;

afterEach(() => {
    viewportCleanup?.();
    viewportCleanup = undefined;
});

function renderWhisper() {
    return render(
        <WhisperCollapsedGroup
            precedingChunks={[
                { kind: 'tool', key: 'chunk-1', toolId: 'tc-1' },
            ]}
            summary={{
                toolCallCount: 3,
                messageCount: 1,
                commitCount: 0,
                startTime: 1000,
                endTime: 3500,
            }}
            toolById={new Map([
                ['tc-1', { toolName: 'view', status: 'completed', startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:00:01Z' }],
            ])}
            toolsWithChildren={new Set()}
            toolParentById={new Map()}
            groupSingleLineMessages={false}
            renderToolTree={(id) => <div data-testid={`tool-${id}`}>{id}</div>}
        />
    );
}

describe('WhisperCollapsedGroup — mobile compact header', () => {
    it('header button has compact padding with md overrides', () => {
        viewportCleanup = mockViewport(375);
        renderWhisper();
        const button = screen.getByTestId('whisper-toggle');
        expect(button.className).toContain('px-2');
        expect(button.className).toContain('py-1');
        expect(button.className).toContain('md:px-3');
        expect(button.className).toContain('md:py-1.5');
    });

    it('header button has desktop padding classes too', () => {
        viewportCleanup = mockViewport(1024);
        renderWhisper();
        const button = screen.getByTestId('whisper-toggle');
        expect(button.className).toContain('md:px-3');
        expect(button.className).toContain('md:py-1.5');
    });
});

describe('WhisperCollapsedGroup — mobile compact expanded body', () => {
    it('expanded body has compact padding and spacing with md overrides', () => {
        viewportCleanup = mockViewport(375);
        renderWhisper();
        // Expand
        fireEvent.click(screen.getByTestId('whisper-toggle'));
        const body = screen.getByTestId('whisper-expanded-content');
        expect(body.className).toContain('px-2');
        expect(body.className).toContain('py-1.5');
        expect(body.className).toContain('space-y-1.5');
        expect(body.className).toContain('md:px-3');
        expect(body.className).toContain('md:py-2');
        expect(body.className).toContain('md:space-y-2');
    });
});
