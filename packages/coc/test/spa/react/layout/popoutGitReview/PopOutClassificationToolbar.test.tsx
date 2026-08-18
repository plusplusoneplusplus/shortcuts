/**
 * Characterization tests for the shared classification toolbar.
 *
 * Commit and PR pop-outs must offer the same controls, labels, disabled states,
 * and error placement — only the test-id prefix differs.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PopOutClassificationToolbar } from '../../../../../src/server/spa/client/react/layout/popoutGitReview/PopOutClassificationToolbar';
import { HUNK_CATEGORIES } from '../../../../../src/server/spa/client/react/features/pull-requests/classification-types';
import type { HunkCategory } from '../../../../../src/server/spa/client/react/features/pull-requests/classification-types';
import type { UseClassificationReturn } from '../../../../../src/server/spa/client/react/features/git/diff/useClassification';
import type { UseModalJobAiSelectionResult } from '../../../../../src/server/spa/client/react/shared/ModalJobAiControls';

vi.mock('../../../../../src/server/spa/client/react/features/git/diff/ClassifyDiffAiControls', () => ({
    ClassifyDiffAiControls: ({ testIdPrefix, disabled }: { testIdPrefix: string; disabled?: boolean }) => (
        <div data-testid={`${testIdPrefix}-ai-controls`} data-disabled={disabled ? 'true' : 'false'} />
    ),
}));

const PREFIXES = ['commit-popout', 'pr-popout'];

function makeClassification(
    status: 'idle' | 'loading' | 'ready',
    overrides: Partial<UseClassificationReturn['state']> = {},
): UseClassificationReturn {
    return {
        state: {
            status,
            error: null,
            activeFilters: new Set<HunkCategory>(['logic']),
            ...overrides,
        },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        getFileBadge: vi.fn(),
        getHunkClassification: vi.fn(),
        isHunkDimmed: vi.fn(),
        isFileDimmed: vi.fn(),
    } as unknown as UseClassificationReturn;
}

const AI_SELECTION = {} as UseModalJobAiSelectionResult;

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe.each(PREFIXES)('PopOutClassificationToolbar (%s)', prefix => {
    it('renders the AI controls, classify button, and chat toggle', () => {
        render(
            <PopOutClassificationToolbar
                testIdPrefix={prefix}
                classification={makeClassification('idle')}
                aiSelection={AI_SELECTION}
                chatOpen={false}
                onToggleChat={vi.fn()}
            />,
        );

        expect(screen.getByTestId(`${prefix}-classify-bar`)).toBeTruthy();
        expect(screen.getByTestId(`${prefix}-classify-ai-controls`)).toBeTruthy();
        expect(screen.getByTestId(`${prefix}-classify-button`).textContent).toContain('Classify');
        expect(screen.getByTestId(`${prefix}-chat-toggle`)).toBeTruthy();
        // The filter bar only appears once results are ready.
        expect(screen.queryByTestId(`${prefix}-filter-bar`)).toBeNull();
    });

    it('disables the classify button and AI controls while classifying', () => {
        render(
            <PopOutClassificationToolbar
                testIdPrefix={prefix}
                classification={makeClassification('loading')}
                aiSelection={AI_SELECTION}
                chatOpen={false}
                onToggleChat={vi.fn()}
            />,
        );

        const button = screen.getByTestId(`${prefix}-classify-button`) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        expect(button.textContent).toContain('Classifying…');
        expect(screen.getByTestId(`${prefix}-classify-ai-controls`).getAttribute('data-disabled')).toBe('true');
    });

    it('offers a re-classify affordance and one checkbox per category when ready', () => {
        const classification = makeClassification('ready');
        render(
            <PopOutClassificationToolbar
                testIdPrefix={prefix}
                classification={classification}
                aiSelection={AI_SELECTION}
                chatOpen={false}
                onToggleChat={vi.fn()}
            />,
        );

        expect(screen.getByTestId(`${prefix}-classify-button`).textContent).toContain('Re-classify');
        expect(screen.getByTestId(`${prefix}-filter-bar`)).toBeTruthy();
        for (const cat of HUNK_CATEGORIES) {
            const label = screen.getByTestId(`${prefix}-filter-${cat}`);
            const checkbox = label.querySelector('input') as HTMLInputElement;
            expect(checkbox.checked).toBe(cat === 'logic');
        }

        fireEvent.click(screen.getByTestId(`${prefix}-filter-test`).querySelector('input')!);
        expect(classification.toggleFilter).toHaveBeenCalledWith('test');
    });

    it('triggers classification and chat toggling', () => {
        const classification = makeClassification('idle');
        const onToggleChat = vi.fn();
        render(
            <PopOutClassificationToolbar
                testIdPrefix={prefix}
                classification={classification}
                aiSelection={AI_SELECTION}
                chatOpen
                onToggleChat={onToggleChat}
            />,
        );

        fireEvent.click(screen.getByTestId(`${prefix}-classify-button`));
        expect(classification.classify).toHaveBeenCalled();

        fireEvent.click(screen.getByTestId(`${prefix}-chat-toggle`));
        expect(onToggleChat).toHaveBeenCalled();
    });

    it('shows classification errors inside the toolbar', () => {
        render(
            <PopOutClassificationToolbar
                testIdPrefix={prefix}
                classification={makeClassification('idle', { error: 'model unavailable' })}
                aiSelection={AI_SELECTION}
                chatOpen={false}
                onToggleChat={vi.fn()}
            />,
        );

        expect(screen.getByTestId(`${prefix}-classify-bar`).textContent).toContain('model unavailable');
    });
});

describe('PopOutClassificationToolbar: commit/PR parity', () => {
    it('renders the same control set for both review types', () => {
        const markup = PREFIXES.map(prefix => {
            const { container, unmount } = render(
                <PopOutClassificationToolbar
                    testIdPrefix={prefix}
                    classification={makeClassification('ready')}
                    aiSelection={AI_SELECTION}
                    chatOpen={false}
                    onToggleChat={vi.fn()}
                />,
            );
            const html = container.innerHTML.replaceAll(prefix, 'PREFIX');
            unmount();
            return html;
        });

        expect(markup[0]).toBe(markup[1]);
    });
});
