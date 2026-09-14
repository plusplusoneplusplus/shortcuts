/**
 * Tests for the running/progress chrome on a tool call row:
 *   - a running call renders a real spinner with an accessible status label,
 *     and keeps the static emoji for settled calls;
 *   - a long-running `read_batch` explains the wait before provider progress,
 *     then shows the latest provider message in its place;
 *   - the elapsed duration advances while running and freezes on settlement;
 *   - the progress text stays a single truncated line on mobile.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider, type ToolCallVariant } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';
import { mockViewport } from '../helpers/viewport-mock';

const START = '2026-01-02T15:04:05.000Z';

let viewportCleanup: (() => void) | undefined;

afterEach(() => {
    viewportCleanup?.();
    viewportCleanup = undefined;
    cleanup();
    vi.useRealTimers();
});

function renderRow(overrides: Record<string, unknown> = {}, variant: ToolCallVariant = 'whisper-row') {
    return render(
        <ToolCallVariantProvider value={variant}>
            <ToolCallView
                toolCall={{
                    id: 'tc-1',
                    toolName: 'read_batch',
                    args: { paths: ['/a.ts', '/b.ts'] },
                    status: 'running',
                    startTime: START,
                    ...overrides,
                }}
            />
        </ToolCallVariantProvider>
    );
}

describe('ToolCallView — running indicator', () => {
    it('renders a spinner with an accessible status label while running', () => {
        renderRow();
        const spinner = screen.getByTestId('tool-call-running-spinner');
        expect(spinner.getAttribute('role')).toBe('status');
        expect(spinner.getAttribute('aria-label')).toBe('Reading files, in progress');
        // Motion is disabled for reduced-motion users without hiding the state.
        expect(spinner.className).toContain('animate-spin');
        expect(spinner.className).toContain('motion-reduce:animate-none');
    });

    it('replaces the card variant status emoji with the spinner while running', () => {
        const { container } = renderRow({}, 'card');
        expect(screen.getByTestId('tool-call-running-spinner')).toBeTruthy();
        expect(container.textContent).not.toContain('🔄');
    });

    it('drops the spinner once the call settles', () => {
        renderRow({ status: 'completed', endTime: START, result: 'done' });
        expect(screen.queryByTestId('tool-call-running-spinner')).toBeNull();
    });
});

describe('ToolCallView — progress text', () => {
    it('explains that reading can take a while before any progress arrives', () => {
        renderRow();
        expect(screen.getByTestId('tool-call-progress').textContent).toBe('Reading files… This can take a while');
    });

    it('replaces the fallback with the provider message in the same row', () => {
        renderRow({ progressMessage: 'Reading 28 files…' });
        const notes = screen.getAllByTestId('tool-call-progress');
        expect(notes).toHaveLength(1);
        expect(notes[0].textContent).toBe('Reading 28 files…');
        expect(notes[0].getAttribute('aria-live')).toBe('polite');
        // Full text stays reachable even though the row truncates.
        expect(notes[0].getAttribute('title')).toBe('Reading 28 files…');
    });

    it('shows progress for a non-read_batch tool and nothing for one without it', () => {
        renderRow({ toolName: 'bash', args: { command: 'npm test' }, progressMessage: 'Running npm test…' });
        expect(screen.getByTestId('tool-call-progress').textContent).toBe('Running npm test…');
        cleanup();

        renderRow({ toolName: 'bash', args: { command: 'npm test' } });
        expect(screen.queryByTestId('tool-call-progress')).toBeNull();
    });

    it('hides progress once the call settles', () => {
        renderRow({ status: 'completed', endTime: START, result: 'done', progressMessage: 'Reading 28 files…' });
        expect(screen.queryByTestId('tool-call-progress')).toBeNull();
    });

    it('keeps the progress text to one truncated line on mobile', () => {
        viewportCleanup = mockViewport(390);
        renderRow({ progressMessage: 'Reading 28 files across four packages in the monorepo…' });
        const note = screen.getByTestId('tool-call-progress');
        expect(note.className).toContain('truncate');
        expect(note.className).toContain('min-w-0');
    });
});

describe('ToolCallView — live elapsed duration', () => {
    it('advances while running and freezes when the call settles', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(START).getTime() + 3_000);

        const { container, rerender } = renderRow();
        const duration = () => container.querySelector('.tool-call-row-duration')?.textContent;
        expect(duration()).toBe('3.0s');

        act(() => { vi.advanceTimersByTime(5_000); });
        expect(duration()).toBe('8.0s');

        rerender(
            <ToolCallVariantProvider value="whisper-row">
                <ToolCallView
                    toolCall={{
                        id: 'tc-1',
                        toolName: 'read_batch',
                        args: { paths: ['/a.ts', '/b.ts'] },
                        status: 'completed',
                        startTime: START,
                        endTime: new Date(new Date(START).getTime() + 8_000).toISOString(),
                        result: 'done',
                    }}
                />
            </ToolCallVariantProvider>
        );
        expect(duration()).toBe('8.0s');

        act(() => { vi.advanceTimersByTime(20_000); });
        expect(duration()).toBe('8.0s');
    });
});
