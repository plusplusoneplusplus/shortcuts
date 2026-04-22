import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommitStrip } from '../../../src/server/spa/client/react/features/chat/conversation/CommitStrip';
import type { DetectedCommit } from '../../../src/server/spa/client/react/features/chat/conversation/commitDetection';

function makeCommit(overrides: Partial<DetectedCommit> = {}): DetectedCommit {
    return {
        shortHash: 'a1b2c3d',
        subject: 'Fix null check in parser',
        branch: 'main',
        toolCallId: 't1',
        ...overrides,
    };
}

describe('CommitStrip', () => {
    let originalHash: string;

    beforeEach(() => {
        originalHash = location.hash;
    });

    it('renders nothing when commits array is empty', () => {
        const { container } = render(<CommitStrip commits={[]} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders a single commit row', () => {
        const commit = makeCommit();
        const { container } = render(<CommitStrip commits={[commit]} />);

        const strip = container.querySelector('[data-testid="commit-strip"]');
        expect(strip).toBeTruthy();

        const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]');
        expect(row).toBeTruthy();
        expect(row!.textContent).toContain('a1b2c3d');
        expect(row!.textContent).toContain('Fix null check in parser');
    });

    it('renders multiple commit rows', () => {
        const commits = [
            makeCommit({ shortHash: 'abc1111', subject: 'First' }),
            makeCommit({ shortHash: 'abc2222', subject: 'Second' }),
        ];
        const { container } = render(<CommitStrip commits={commits} />);

        expect(container.querySelector('[data-testid="commit-strip-row-abc1111"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="commit-strip-row-abc2222"]')).toBeTruthy();
    });

    it('shows diff stats when available', () => {
        const commit = makeCommit({
            insertions: 42,
            deletions: 17,
            filesChanged: 3,
        });
        const { container } = render(<CommitStrip commits={[commit]} />);

        const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]');
        expect(row!.textContent).toContain('+42');
        expect(row!.textContent).toContain('−17');
        expect(row!.textContent).toContain('3 files');
    });

    it('shows singular "file" for 1 file changed', () => {
        const commit = makeCommit({ filesChanged: 1, insertions: 5 });
        const { container } = render(<CommitStrip commits={[commit]} />);

        const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]');
        expect(row!.textContent).toContain('1 file');
        expect(row!.textContent).not.toContain('1 files');
    });

    it('omits diff stats when not available', () => {
        const commit = makeCommit();
        const { container } = render(<CommitStrip commits={[commit]} />);

        const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]');
        expect(row!.textContent).not.toContain('+');
        expect(row!.textContent).not.toContain('−');
        expect(row!.textContent).not.toContain('file');
    });

    it('renders 🔀 icon', () => {
        const commit = makeCommit();
        const { container } = render(<CommitStrip commits={[commit]} />);

        const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]');
        expect(row!.textContent).toContain('🔀');
    });

    describe('navigation', () => {
        it('navigates to commit detail on click when workspaceId is provided', () => {
            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );

            const row = container.querySelector('[data-testid="commit-strip-row-abc1234"]')!;
            fireEvent.click(row);

            expect(location.hash).toBe('#repos/ws-test/git/abc1234');
            location.hash = originalHash;
        });

        it('uses fullHash for navigation when available', () => {
            const commit = makeCommit({
                shortHash: 'abc1234',
                fullHash: 'abc1234567890abcdef1234567890abcdef123456',
            });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );

            const row = container.querySelector('[data-testid="commit-strip-row-abc1234"]')!;
            fireEvent.click(row);

            expect(location.hash).toBe('#repos/ws-test/git/abc1234567890abcdef1234567890abcdef123456');
            location.hash = originalHash;
        });

        it('does not navigate when workspaceId is not provided', () => {
            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(<CommitStrip commits={[commit]} />);

            const row = container.querySelector('[data-testid="commit-strip-row-abc1234"]')!;
            const prevHash = location.hash;
            fireEvent.click(row);

            expect(location.hash).toBe(prevHash);
        });

        it('has cursor-pointer class when workspaceId is provided', () => {
            const commit = makeCommit();
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );

            const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]')!;
            expect(row.className).toContain('cursor-pointer');
        });

        it('calls stopPropagation on click event', () => {
            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );

            const row = container.querySelector('[data-testid="commit-strip-row-abc1234"]')!;
            const event = new MouseEvent('click', { bubbles: true });
            const stopSpy = vi.spyOn(event, 'stopPropagation');
            row.dispatchEvent(event);

            expect(stopSpy).toHaveBeenCalled();
            location.hash = originalHash;
        });

        it('URI-encodes workspaceId in navigation hash', () => {
            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws/special id" />
            );

            const row = container.querySelector('[data-testid="commit-strip-row-abc1234"]')!;
            fireEvent.click(row);

            expect(location.hash).toBe('#repos/ws%2Fspecial%20id/git/abc1234');
            location.hash = originalHash;
        });

        it('does not have cursor-pointer class when workspaceId is missing', () => {
            const commit = makeCommit();
            const { container } = render(<CommitStrip commits={[commit]} />);

            const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]')!;
            expect(row.className).not.toContain('cursor-pointer');
        });
    });

    describe('styling', () => {
        it('has blue-tint background', () => {
            const commit = makeCommit();
            const { container } = render(<CommitStrip commits={[commit]} />);

            const row = container.querySelector('[data-testid="commit-strip-row-a1b2c3d"]')!;
            expect(row.className).toContain('bg-[#f0f7ff]');
        });

        it('has orange hash styling', () => {
            const commit = makeCommit();
            const { container } = render(<CommitStrip commits={[commit]} />);

            const hashEl = container.querySelector('.font-mono');
            expect(hashEl).toBeTruthy();
            expect(hashEl!.className).toContain('text-[#f57c00]');
        });
    });
});
