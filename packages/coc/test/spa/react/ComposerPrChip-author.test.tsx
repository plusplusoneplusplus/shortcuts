/**
 * @vitest-environment jsdom
 *
 * Tests for the composer PR chip's author label (AC-01 / AC-02).
 *
 * Covers:
 *  - AC-01: the ready chip renders the PR author as muted `by <alias>` right
 *    after the title and before the status badge, with the displayName →
 *    email-local-part → id resolution priority, and the full alias in a tooltip.
 *  - AC-02: the author is shown at wide/medium width and hidden when the chip's
 *    own container measures narrow (<500px, width > 0), via a mocked
 *    `useContainerWidth`. It stays visible before first measurement (width 0).
 *  - The author is omitted (no placeholder) when author data is absent/empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Container-width mock — controlled per-test via setContainerWidth().
// ---------------------------------------------------------------------------

let currentTier: 'wide' | 'medium' | 'narrow' = 'wide';
let currentWidth = 900;

function setContainerWidth(tier: 'wide' | 'medium' | 'narrow', width: number) {
    currentTier = tier;
    currentWidth = width;
}

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
    useContainerWidth: () => ({
        width: currentWidth,
        tier: currentTier,
        isWide: currentTier === 'wide',
        isMedium: currentTier === 'medium',
        isNarrow: currentTier === 'narrow',
    }),
}));

import { ComposerPrChip } from '../../../src/server/spa/client/react/features/chat/conversation/ComposerPrChip';
import type { PrStatusCardItem } from '../../../src/server/spa/client/react/features/chat/conversation/PrStatusCard';
import type { PrIdentity } from '../../../src/server/spa/client/react/features/pull-requests/pr-utils';

const KEY = 'gh_owner_repo:42';

function readyItem(author?: PrIdentity): PrStatusCardItem {
    return {
        key: KEY,
        repoId: 'ws1',
        number: 42,
        state: 'ready',
        pr: {
            number: 42,
            title: 'Dark mode: settings schedules',
            status: 'open',
            sourceBranch: 'feat/dark-settings',
            targetBranch: 'main',
            url: 'https://github.com/owner/repo/pull/42',
            author,
        },
    };
}

describe('ComposerPrChip — author label (AC-01)', () => {
    beforeEach(() => setContainerWidth('wide', 900));

    it('renders `by <displayName>` after the title and before the status badge', () => {
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ id: 'u1', displayName: 'Alice Doe' })} onDismiss={() => {}} />,
        );
        const author = getByTestId('composer-pr-chip-author');
        expect(author.textContent).toBe('by Alice Doe');
        // Muted, non-bold — no font-semibold on the author element.
        expect(author.className).not.toContain('font-semibold');
        expect(author.className).toContain('shrink-0');
        // Full alias in the tooltip.
        expect(author.getAttribute('title')).toBe('Alice Doe');

        const title = getByTestId('composer-pr-chip-title');
        const status = getByTestId('composer-pr-chip-status');
        expect(title.compareDocumentPosition(author) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(author.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('falls back to the email local-part when displayName is absent', () => {
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ id: 'u1', email: 'bob.smith@example.com' })} onDismiss={() => {}} />,
        );
        const author = getByTestId('composer-pr-chip-author');
        expect(author.textContent).toBe('by bob.smith');
        expect(author.getAttribute('title')).toBe('bob.smith');
    });

    it('falls back to String(id) when displayName and email are absent', () => {
        const { getByTestId } = render(
            <ComposerPrChip item={readyItem({ id: 12345 })} onDismiss={() => {}} />,
        );
        expect(getByTestId('composer-pr-chip-author').textContent).toBe('by 12345');
    });

    it('prefers displayName over email and id', () => {
        const { getByTestId } = render(
            <ComposerPrChip
                item={readyItem({ id: 'u1', displayName: 'Carol', email: 'carol@example.com' })}
                onDismiss={() => {}}
            />,
        );
        expect(getByTestId('composer-pr-chip-author').textContent).toBe('by Carol');
    });

    it('omits the author element (no placeholder) when author is absent', () => {
        const { queryByTestId } = render(<ComposerPrChip item={readyItem(undefined)} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-author')).toBeNull();
    });

    it('omits the author element when the alias resolves empty', () => {
        const { queryByTestId } = render(
            <ComposerPrChip item={readyItem({ displayName: '   ', email: '' })} onDismiss={() => {}} />,
        );
        expect(queryByTestId('composer-pr-chip-author')).toBeNull();
    });
});

describe('ComposerPrChip — author label adaptive hide (AC-02)', () => {
    const item = readyItem({ id: 'u1', displayName: 'Alice Doe' });

    it('shows the author at wide width', () => {
        setContainerWidth('wide', 900);
        const { queryByTestId } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-author')).not.toBeNull();
    });

    it('shows the author at medium width', () => {
        setContainerWidth('medium', 600);
        const { queryByTestId } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-author')).not.toBeNull();
    });

    it('hides the author at narrow width once measured', () => {
        setContainerWidth('narrow', 420);
        const { queryByTestId } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-author')).toBeNull();
    });

    it('keeps the author visible before first measurement (width 0)', () => {
        // width === 0 → not yet measured; the `width > 0` guard keeps it shown.
        setContainerWidth('narrow', 0);
        const { queryByTestId } = render(<ComposerPrChip item={item} onDismiss={() => {}} />);
        expect(queryByTestId('composer-pr-chip-author')).not.toBeNull();
    });
});
