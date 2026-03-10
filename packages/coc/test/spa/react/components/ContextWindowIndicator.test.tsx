import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextWindowIndicator } from '../../../../src/server/spa/client/react/components/ContextWindowIndicator';

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
});
