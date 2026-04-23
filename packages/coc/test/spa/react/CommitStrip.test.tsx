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

    describe('pop-out button', () => {
        let originalOpen: typeof window.open;

        beforeEach(() => {
            originalOpen = window.open;
        });

        function restoreOpen() {
            window.open = originalOpen;
        }

        it('renders pop-out button when workspaceId is provided', () => {
            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );
            const btn = container.querySelector('[data-testid="commit-strip-popout-abc1234"]');
            expect(btn).toBeTruthy();
            expect(btn!.getAttribute('title')).toBe('Open in new window');
            expect(btn!.getAttribute('aria-label')).toBe('Open commit in new window');
            expect(btn!.textContent).toContain('↗️');
        });

        it('does not render pop-out button when workspaceId is missing', () => {
            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(<CommitStrip commits={[commit]} />);
            const btn = container.querySelector('[data-testid="commit-strip-popout-abc1234"]');
            expect(btn).toBeNull();
        });

        it('calls window.open with pop-out URL and named window on click', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            const commit = makeCommit({
                shortHash: 'abc1234',
                fullHash: 'abc12340000000000000000000000000000000de',
            });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );
            const btn = container.querySelector('[data-testid="commit-strip-popout-abc1234"]')!;
            fireEvent.click(btn);

            expect(openSpy).toHaveBeenCalledTimes(1);
            const [url, name, features] = openSpy.mock.calls[0];
            expect(url).toBe('/?workspace=ws-test#popout/git-review/abc12340000000000000000000000000000000de');
            expect(name).toBe('coc-git-review-abc12340000000000000000000000000000000de');
            expect(features).toContain('width=');
            expect(features).toContain('height=');
            restoreOpen();
        });

        it('uses shortHash when fullHash is not available for pop-out', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            const commit = makeCommit({ shortHash: 'shortx1' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );
            const btn = container.querySelector('[data-testid="commit-strip-popout-shortx1"]')!;
            fireEvent.click(btn);

            const [, name] = openSpy.mock.calls[0];
            expect(name).toBe('coc-git-review-shortx1');
            restoreOpen();
        });

        it('does not navigate the main window hash when clicking pop-out', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );
            const prevHash = location.hash;
            const btn = container.querySelector('[data-testid="commit-strip-popout-abc1234"]')!;
            fireEvent.click(btn);

            expect(location.hash).toBe(prevHash);
            restoreOpen();
        });

        it('stops propagation so the row onClick does not fire', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            const commit = makeCommit({ shortHash: 'abc1234' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws-test" />
            );
            const prevHash = location.hash;
            const btn = container.querySelector('[data-testid="commit-strip-popout-abc1234"]')!;
            const event = new MouseEvent('click', { bubbles: true });
            const stopSpy = vi.spyOn(event, 'stopPropagation');
            btn.dispatchEvent(event);

            expect(stopSpy).toHaveBeenCalled();
            expect(location.hash).toBe(prevHash);
            restoreOpen();
        });

        it('encodes workspaceId and hash in pop-out URL', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            const commit = makeCommit({ shortHash: 'ab/cd' });
            const { container } = render(
                <CommitStrip commits={[commit]} workspaceId="ws/space id" />
            );
            const btn = container.querySelector('[data-testid="commit-strip-popout-ab/cd"]')!;
            fireEvent.click(btn);

            const [url] = openSpy.mock.calls[0];
            expect(url).toContain('workspace=ws%2Fspace%20id');
            expect(url).toContain('#popout/git-review/ab%2Fcd');
            restoreOpen();
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
