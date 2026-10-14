import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';
import { buildToolCallRenderModel } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolCallRenderModel';
import { mockViewport } from '../helpers/viewport-mock';

let restoreViewport: (() => void) | undefined;
afterEach(() => { cleanup(); restoreViewport?.(); restoreViewport = undefined; vi.unstubAllGlobals(); });

const timed = { startTime: '2026-01-02T15:04:05.000Z', endTime: '2026-01-02T15:04:05.020Z' };

describe('tool response size semantics', () => {
    it.each([
        ['', 0, '0 B'], ['abc', 3, '3 B'], ['é中😀', 9, '9 B'],
        ['\ud800', 3, '3 B'], ['a'.repeat(1023), 1023, '1023 B'],
        ['a'.repeat(1024), 1024, '1.0 KiB'],
        ['a'.repeat(1024 * 1024), 1024 * 1024, '1.0 MiB'],
    ])('measures UTF-8 bytes for case %#', (result, bytes, label) => {
        const model = buildToolCallRenderModel({ name: 'Read', result }, 'card');
        expect(model.responseSize).toMatchObject({ bytes, label });
        expect(model.responseSize?.explanation).toContain(`${bytes.toLocaleString('en-US')} bytes (UTF-8`);
    });

    it.each([undefined, null])('omits unavailable response %#', result => {
        expect(buildToolCallRenderModel({ result: result as any, error: 'failed' }, 'card').responseSize).toBeNull();
    });

    it('measures raw available content before presentation extraction and display clipping', () => {
        const result = JSON.stringify({ textResultForLlm: 'é'.repeat(6000),
            binaryResultsForLlm: [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }] });
        const model = buildToolCallRenderModel({ toolName: 'browser', result }, 'whisper-row');
        expect(model.isResultTruncated).toBe(true);
        expect(model.responseSize?.bytes).toBe(Buffer.byteLength(result, 'utf8'));
        expect(model.responseSize?.bytes).toBeGreaterThan(Buffer.byteLength(model.visibleResult));
        expect(model.responseSize?.explanation).toContain('serialized JSON/base64');
    });

    it('prefers a reliable retained byte count, including zero, without requiring response text', () => {
        for (const bytes of [0, 4096]) {
            expect(buildToolCallRenderModel({ availableResponseBytes: bytes }, 'card').responseSize?.bytes).toBe(bytes);
            expect(buildToolCallRenderModel({ result: 'preview', availableResponseBytes: bytes }, 'card').responseSize?.bytes).toBe(bytes);
        }
    });

    it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid retained size %#', availableResponseBytes => {
        expect(buildToolCallRenderModel({ availableResponseBytes }, 'card').responseSize).toBeNull();
        expect(buildToolCallRenderModel({ result: 'é', availableResponseBytes }, 'card').responseSize?.bytes).toBe(2);
    });

    it('does not interpret size or token claims inside tool output as trusted metadata', () => {
        const result = '{"responseSize":1000000,"tokens":42,"text":"truncated"}';
        const model = buildToolCallRenderModel({ result }, 'card');
        expect(model.responseSize?.bytes).toBe(Buffer.byteLength(result));
        expect(model.responseSize?.explanation).toContain('excludes unavailable or omitted content');
    });
});

describe('tool response size headers', () => {
    it.each(['card', 'whisper-row'] as const)('keeps size beside duration with accessible semantics in %s', variant => {
        restoreViewport = mockViewport(320);
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const { container } = render(<ToolCallVariantProvider value={variant}>
            <ToolCallView toolCall={{ name: 'Read', parameters: { path: '/very/long/path/file.ts' }, result: 'é中😀', status: 'completed', ...timed }} />
        </ToolCallVariantProvider>);
        const size = screen.getByTestId('tool-call-response-size');
        expect(size.textContent).toBe('9 B');
        expect(size.previousElementSibling?.textContent).toBe('20ms');
        expect(size.className).toContain('shrink-0');
        expect(size.className).toContain('whitespace-nowrap');
        expect(size.getAttribute('aria-label')).toBe(size.getAttribute('title'));
        expect(size.getAttribute('aria-label')).toContain('Not a token count or original payload size');
        const summary = container.querySelector('.tool-call-row-path, .tool-call-header .truncate');
        expect(summary?.className).toContain('min-w-0');
        fireEvent.click(screen.getByRole('button', { name: 'Preview result' }));
        expect(screen.getByTestId('tool-result-popover').textContent).toContain('é中😀');
        fireEvent.click(container.querySelector('.tool-call-row-header, .tool-call-header')!);
        expect(container.querySelector('.tool-call-row-body, .tool-call-body')?.className).not.toContain('hidden');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('shows empty response size without timing, and removes it when response becomes unavailable', () => {
        const { rerender } = render(<ToolCallView toolCall={{ name: 'Read', result: '', status: 'completed' }} />);
        expect(screen.getByTestId('tool-call-response-size').textContent).toBe('0 B');
        expect(screen.getByTestId('tool-call-response-size').className).toContain('ml-auto');
        rerender(<ToolCallView toolCall={{ name: 'Read', status: 'running' }} />);
        expect(screen.queryByTestId('tool-call-response-size')).toBeNull();
    });

    it('preserves browser preview and subtool controls alongside size', () => {
        const toggle = vi.fn();
        const { container } = render(<ToolCallView toolCall={{ toolName: 'browser', args: { action: 'read' }, result: 'ok', status: 'completed', ...timed }}
            hasSubtools subtoolsCollapsed onToggleSubtools={toggle} />);
        expect(container.querySelector('.tool-call-row-path')?.textContent).toBe('read');
        expect(screen.getByTestId('tool-call-response-size').textContent).toBe('2 B');
        fireEvent.click(screen.getByRole('button', { name: 'Expand subtools' }));
        expect(toggle).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Preview result' }));
        expect(screen.getByTestId('tool-result-popover').textContent).toContain('ok');
    });
});
