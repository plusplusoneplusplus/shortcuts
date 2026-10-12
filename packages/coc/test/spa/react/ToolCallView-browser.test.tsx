import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';
import { getToolResultPresentation } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolResultPresentation';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('browser tool presentation', () => {
    it.each([
        [{ action: 'click', ref: 'e12' }, 'click · e12'],
        [{ action: 'open', url: 'http://localhost:8000/form' }, 'open · http://localhost:8000/form'],
        [{ action: 'select', tab: 'owner|browser|t3' }, 'select · owner|browser|t3'],
    ])('shows one compact row with action and target', (args, summary) => {
        const { container } = render(<ToolCallView toolCall={{ toolName: 'browser', args, result: 'ok', status: 'completed' }} />);
        expect(container.querySelector('.tool-call-card')).toBeNull();
        expect(container.querySelector('.tool-call-row-path')?.textContent).toBe(summary);
        expect(screen.getByTestId('tool-call-kind').textContent).toBe('Browser');
    });

    it.each(['copilot', 'claude', 'codex', 'opencode'])('previews a %s screenshot without showing binary JSON', provider => {
        vi.useFakeTimers();
        const result = JSON.stringify({
            textResultForLlm: 'Screenshot captured',
            resultType: 'success',
            binaryResultsForLlm: [{ type: 'image', data: '/9j/4AAQ', mimeType: 'image/jpeg', description: 'Browser screenshot' }],
        });
        const identity = provider === 'codex'
            ? { toolName: 'browser', parameters: { action: 'screenshot' } }
            : provider === 'opencode' ? { name: 'browser', args: { action: 'screenshot' } }
                : { toolName: 'browser', args: '{"action":"screenshot"}' };
        const { container } = render(<ToolCallVariantProvider value={provider === 'copilot' ? 'whisper-row' : 'card'}>
            <ToolCallView toolCall={{ ...identity, result, status: 'completed' }} />
        </ToolCallVariantProvider>);
        fireEvent.mouseEnter(container.querySelector('.tool-call-row-header')!);
        act(() => vi.advanceTimersByTime(300));
        const thumbnail = screen.getByTestId('tool-result-thumbnail');
        expect(thumbnail.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/4AAQ');
        expect(screen.getByTestId('tool-result-popover').textContent).toContain('Screenshot captured');
        expect(screen.getByTestId('tool-result-popover').textContent).not.toContain('/9j/4AAQ');
        fireEvent.click(screen.getByRole('button', { name: 'Enlarge Browser screenshot' }));
        expect(screen.getByTestId('image-lightbox')).toBeTruthy();
    });

    it('opens an MCP screenshot thumbnail through the keyboard-accessible result button', () => {
        render(<ToolCallView toolCall={{ toolName: 'browser', args: { action: 'screenshot' }, status: 'completed',
            result: JSON.stringify({ content: [{ type: 'image', data: '/9j/4AAQ', mimeType: 'image/jpeg' }] }) }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview result' }));
        expect(screen.getByTestId('tool-result-thumbnail').getAttribute('src')).toBe('data:image/jpeg;base64,/9j/4AAQ');
    });

    it('accepts MCP image blocks and rejects paths, SVG and malformed image data', () => {
        expect(getToolResultPresentation(JSON.stringify({ content: [
            { type: 'text', text: 'Screenshot' },
            { type: 'image', data: '/9j/4AAQ', mimeType: 'image/jpeg' },
        ] })).images[0].src).toBe('data:image/jpeg;base64,/9j/4AAQ');
        expect(getToolResultPresentation(JSON.stringify({ binaryResultsForLlm: [
            { type: 'image', data: '../capture.jpg', mimeType: 'image/jpeg' },
            { type: 'image', data: 'YWJj', mimeType: 'image/svg+xml' },
        ] })).images).toEqual([]);
    });
});
