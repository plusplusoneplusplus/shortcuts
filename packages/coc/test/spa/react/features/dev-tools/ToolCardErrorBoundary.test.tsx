/**
 * AC-04 — per-card error containment. One tool throwing during render must
 * degrade to an inline message inside its own card, leaving the filter box and
 * every sibling card intact.
 *
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ToolCard } from '../../../../../src/server/spa/client/react/features/dev-tools/ToolCard';
import { DevToolsPanel } from '../../../../../src/server/spa/client/react/features/dev-tools/DevToolsPanel';
import type { DevTool } from '../../../../../src/server/spa/client/react/features/dev-tools/types';

function Boom() {
    throw new Error('kaboom');
}

function Fine() {
    return <p data-testid="fine-body">fine</p>;
}

const BOOM_TOOL: DevTool = {
    id: 'boom',
    name: 'Exploding tool',
    description: 'throws on render',
    keywords: ['boom'],
    component: Boom,
};

const FINE_TOOL: DevTool = {
    id: 'fine',
    name: 'Working tool',
    description: 'renders fine',
    keywords: ['fine'],
    component: Fine,
};

// A getter, because the mock factory is hoisted above the constants above.
vi.mock('../../../../../src/server/spa/client/react/features/dev-tools/registry', () => ({
    get DEV_TOOLS() {
        return [BOOM_TOOL, FINE_TOOL];
    },
    DEFAULT_EXPANDED_TOOL_ID: 'boom',
}));

// React logs every caught render error to console.error; silence it so a
// passing run stays readable.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    consoleError.mockRestore();
});

describe('ToolCard error containment', () => {
    it('renders an inline error inside the card instead of propagating', () => {
        render(
            <ToolCard id="boom" name="Exploding tool" description="throws" expanded onToggle={vi.fn()}>
                <Boom />
            </ToolCard>,
        );
        const message = screen.getByTestId('dev-tool-error-boom').textContent ?? '';
        expect(message).toContain('This tool crashed');
        expect(message).toContain('kaboom');
        // The card itself — header included — is still on screen.
        expect(screen.getByTestId('dev-tool-toggle-boom')).toBeTruthy();
    });

    it('does not fall back to the full-screen recovery UI', () => {
        render(
            <ToolCard id="boom" name="Exploding tool" description="throws" expanded onToggle={vi.fn()}>
                <Boom />
            </ToolCard>,
        );
        expect(screen.queryByText('Something went wrong')).toBeNull();
        expect(screen.queryByText(/Clear Cache/)).toBeNull();
    });

    it('keeps the rest of the panel usable when one card throws', () => {
        render(<DevToolsPanel />);
        expect(screen.getByTestId('dev-tool-error-boom')).toBeTruthy();
        // Filter box and the sibling card survived.
        expect(screen.getByTestId('dev-tools-filter')).toBeTruthy();
        expect(screen.getByTestId('dev-tool-card-fine')).toBeTruthy();
        // And the sibling is still interactive.
        fireEvent.click(screen.getByTestId('dev-tool-toggle-fine'));
        expect(screen.getByTestId('fine-body')).toBeTruthy();
    });

    it('clears the error when the card is collapsed and reopened', () => {
        let shouldThrow = true;
        function Flaky() {
            if (shouldThrow) throw new Error('kaboom');
            return <p data-testid="recovered">recovered</p>;
        }
        function Harness() {
            const [expanded, setExpanded] = useState(true);
            return (
                <ToolCard
                    id="flaky"
                    name="Flaky"
                    description="throws once"
                    expanded={expanded}
                    onToggle={() => setExpanded(v => !v)}
                >
                    <Flaky />
                </ToolCard>
            );
        }

        render(<Harness />);
        expect(screen.getByTestId('dev-tool-error-flaky')).toBeTruthy();
        shouldThrow = false;
        fireEvent.click(screen.getByTestId('dev-tool-toggle-flaky'));
        fireEvent.click(screen.getByTestId('dev-tool-toggle-flaky'));
        expect(screen.getByTestId('recovered')).toBeTruthy();
        expect(screen.queryByTestId('dev-tool-error-flaky')).toBeNull();
    });
});
