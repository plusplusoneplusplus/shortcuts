import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextWindowIndicator } from '../../../src/server/spa/client/react/ui/ContextWindowIndicator';

describe('ContextWindowIndicator', () => {
    it('renders nothing when tokenLimit is not provided', () => {
        const { container } = render(<ContextWindowIndicator />);
        expect(container.firstChild).toBeNull();
    });

    it('renders ctx label with token counts when tokenLimit is provided', () => {
        render(<ContextWindowIndicator tokenLimit={128000} currentTokens={12000} />);
        expect(screen.getByText('ctx')).toBeDefined();
        expect(screen.getByText('12.0k/128.0k')).toBeDefined();
    });

    it('does NOT render model name label when modelName is omitted', () => {
        render(<ContextWindowIndicator tokenLimit={128000} currentTokens={12000} />);
        expect(screen.queryByText('gpt-4o')).toBeNull();
    });

    it('renders model name to the left of ctx when modelName is provided', () => {
        render(<ContextWindowIndicator tokenLimit={128000} currentTokens={12000} modelName="gpt-4o" />);
        const modelLabel = screen.getByText('gpt-4o');
        expect(modelLabel).toBeDefined();
        expect(modelLabel.className).toContain('shrink-0');
        expect(modelLabel.className).toContain('whitespace-nowrap');
    });

    it('model name appears before the ctx span in document order', () => {
        render(<ContextWindowIndicator tokenLimit={128000} currentTokens={12000} modelName="gpt-4o" />);
        const modelLabel = screen.getByText('gpt-4o');
        const ctxLabel = screen.getByText('ctx');
        // 4 = DOCUMENT_POSITION_FOLLOWING: ctxLabel follows modelLabel
        expect(modelLabel.compareDocumentPosition(ctxLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders without model name when modelName is undefined', () => {
        render(<ContextWindowIndicator tokenLimit={128000} currentTokens={0} modelName={undefined} />);
        expect(screen.queryByText('undefined')).toBeNull();
        expect(screen.getByText('ctx')).toBeDefined();
    });

    it('forwards className to the wrapper', () => {
        const { container } = render(
            <ContextWindowIndicator tokenLimit={1000} currentTokens={100} className="my-test-class" />,
        );
        expect((container.firstChild as HTMLElement).className).toContain('my-test-class');
    });

    // — Single-bar fallback (no breakdown props) ——————————————————————————

    it('renders single-colour bar when no breakdown props are given', () => {
        render(<ContextWindowIndicator tokenLimit={200000} currentTokens={50000} />);
        expect(screen.getByTestId('context-window-bar')).toBeDefined();
        expect(screen.queryByTestId('ctx-segment-system')).toBeNull();
    });

    it('uses green bar at low usage (<50%)', () => {
        render(<ContextWindowIndicator tokenLimit={200000} currentTokens={50000} />);
        const bar = screen.getByTestId('context-window-bar');
        expect(bar.className).toContain('bg-green-500');
    });

    it('uses yellow bar in the warn range (50–80%)', () => {
        render(<ContextWindowIndicator tokenLimit={200000} currentTokens={120000} />);
        const bar = screen.getByTestId('context-window-bar');
        expect(bar.className).toContain('bg-yellow-500');
    });

    it('uses red bar above 80%', () => {
        render(<ContextWindowIndicator tokenLimit={200000} currentTokens={180000} />);
        const bar = screen.getByTestId('context-window-bar');
        expect(bar.className).toContain('bg-red-500');
    });

    // — Segmented bar (breakdown props present) ———————————————————————————

    it('renders three coloured segments when breakdown props are provided', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={70000}
                systemTokens={12000}
                toolDefinitionsTokens={8000}
                conversationTokens={47000}
            />,
        );
        expect(screen.getByTestId('ctx-segment-system')).toBeDefined();
        expect(screen.getByTestId('ctx-segment-tools')).toBeDefined();
        expect(screen.getByTestId('ctx-segment-conversation')).toBeDefined();
        expect(screen.queryByTestId('context-window-bar')).toBeNull();
    });

    it('system segment uses purple colour', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={30000}
                systemTokens={10000}
                toolDefinitionsTokens={10000}
                conversationTokens={10000}
            />,
        );
        const seg = screen.getByTestId('ctx-segment-system');
        expect(seg.className).toContain('bg-purple-500');
    });

    it('tools segment uses blue colour', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={30000}
                systemTokens={10000}
                toolDefinitionsTokens={10000}
                conversationTokens={10000}
            />,
        );
        const seg = screen.getByTestId('ctx-segment-tools');
        expect(seg.className).toContain('bg-blue-500');
    });

    it('conversation segment uses green colour', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={30000}
                systemTokens={10000}
                toolDefinitionsTokens={10000}
                conversationTokens={10000}
            />,
        );
        const seg = screen.getByTestId('ctx-segment-conversation');
        expect(seg.className).toContain('bg-green-500');
    });

    it('renders other segment (gray) when currentTokens exceeds the sum of breakdown tokens', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={75000}
                systemTokens={10000}
                toolDefinitionsTokens={10000}
                conversationTokens={50000}
            />,
        );
        expect(screen.getByTestId('ctx-segment-other')).toBeDefined();
        const seg = screen.getByTestId('ctx-segment-other');
        expect(seg.className).toContain('bg-gray-400');
    });

    it('omits other segment when breakdown tokens sum equals currentTokens', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={30000}
                systemTokens={10000}
                toolDefinitionsTokens={10000}
                conversationTokens={10000}
            />,
        );
        expect(screen.queryByTestId('ctx-segment-other')).toBeNull();
    });

    // — Breakdown popover ——————————————————————————————————————————————————

    it('shows breakdown popover on hover when breakdown is available', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={70000}
                systemTokens={12000}
                toolDefinitionsTokens={8000}
                conversationTokens={47000}
            />,
        );
        expect(screen.queryByTestId('ctx-breakdown-popover')).toBeNull();
        fireEvent.mouseEnter(screen.getByTestId('context-window-indicator'));
        expect(screen.getByTestId('ctx-breakdown-popover')).toBeDefined();
    });

    it('hides breakdown popover on mouse leave', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={70000}
                systemTokens={12000}
                toolDefinitionsTokens={8000}
                conversationTokens={47000}
            />,
        );
        const indicator = screen.getByTestId('context-window-indicator');
        fireEvent.mouseEnter(indicator);
        expect(screen.getByTestId('ctx-breakdown-popover')).toBeDefined();
        fireEvent.mouseLeave(indicator);
        expect(screen.queryByTestId('ctx-breakdown-popover')).toBeNull();
    });

    it('toggles breakdown popover on click (mobile tap)', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={70000}
                systemTokens={12000}
                toolDefinitionsTokens={8000}
                conversationTokens={47000}
            />,
        );
        const indicator = screen.getByTestId('context-window-indicator');
        fireEvent.click(indicator);
        expect(screen.getByTestId('ctx-breakdown-popover')).toBeDefined();
        fireEvent.click(indicator);
        expect(screen.queryByTestId('ctx-breakdown-popover')).toBeNull();
    });

    it('does NOT show popover when breakdown props are absent', () => {
        render(<ContextWindowIndicator tokenLimit={200000} currentTokens={70000} />);
        fireEvent.mouseEnter(screen.getByTestId('context-window-indicator'));
        expect(screen.queryByTestId('ctx-breakdown-popover')).toBeNull();
    });

    it('popover lists all four categories', () => {
        render(
            <ContextWindowIndicator
                tokenLimit={200000}
                currentTokens={72300}
                systemTokens={12000}
                toolDefinitionsTokens={8000}
                conversationTokens={47000}
            />,
        );
        fireEvent.mouseEnter(screen.getByTestId('context-window-indicator'));
        const popover = screen.getByTestId('ctx-breakdown-popover');
        expect(popover.textContent).toContain('System prompt');
        expect(popover.textContent).toContain('Tool definitions');
        expect(popover.textContent).toContain('Conversation');
        expect(popover.textContent).toContain('Other');
        expect(popover.textContent).toContain('Total');
    });
});
