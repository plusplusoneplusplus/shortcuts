import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkSkillSourcePopover } from '../../../../src/server/spa/client/react/features/skills/LinkSkillSourcePopover';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

const repo = { workspace: { id: 'repo-a', name: 'Repo A', rootPath: '/repo-a', color: '#abc' } } as any;

describe('LinkSkillSourcePopover', () => {
    it('batches repo probes and ignores results from an older repo-list generation', async () => {
        const oldProbe = deferred<any>();
        const newProbe = deferred<any>();
        const loadRepoSkills = vi.fn()
            .mockReturnValueOnce(oldProbe.promise)
            .mockReturnValueOnce(newProbe.promise);
        const common = {
            linkedRepoIds: [],
            loadRepoSkills,
            onLink: vi.fn().mockResolvedValue(true),
            onUnlink: vi.fn().mockResolvedValue(undefined),
            onClose: vi.fn(),
        };
        const { rerender } = render(<LinkSkillSourcePopover repos={[repo]} {...common} />);

        rerender(<LinkSkillSourcePopover repos={[{ ...repo }]} {...common} />);
        await act(async () => {
            newProbe.resolve({ path: '/repo-a/.github/skills', skillCount: 2, accessible: true });
            await newProbe.promise;
        });
        await waitFor(() => expect(screen.getByTestId('repo-picker-count-repo-a').textContent).toBe('2 skills'));

        await act(async () => {
            oldProbe.resolve({ path: '/repo-a/.github/skills', skillCount: 99, accessible: true });
            await oldProbe.promise;
        });

        expect(screen.getByTestId('repo-picker-count-repo-a').textContent).toBe('2 skills');
    });

    it('renders an explicit unavailable state when probing fails', async () => {
        render(
            <LinkSkillSourcePopover
                repos={[repo]}
                linkedRepoIds={[]}
                loadRepoSkills={vi.fn().mockRejectedValue(new Error('offline'))}
                onLink={vi.fn().mockResolvedValue(false)}
                onUnlink={vi.fn().mockResolvedValue(undefined)}
                onClose={vi.fn()}
            />,
        );

        await waitFor(() => expect(screen.getByTestId('repo-picker-count-repo-a').textContent).toBe('Unavailable'));
        expect((screen.getByTestId('repo-picker-item-repo-a') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('repo-picker-item-repo-a').getAttribute('title')).toBe('offline');
    });

    it('renders a clear empty state when the filter has no matches', () => {
        const repos = Array.from({ length: 9 }, (_, index) => ({
            workspace: { id: `repo-${index}`, name: `Repo ${index}`, rootPath: `/repo-${index}` },
        })) as any;
        render(
            <LinkSkillSourcePopover
                repos={repos}
                linkedRepoIds={[]}
                loadRepoSkills={vi.fn().mockResolvedValue({ path: '', skillCount: 0, accessible: true })}
                onLink={vi.fn().mockResolvedValue(false)}
                onUnlink={vi.fn().mockResolvedValue(undefined)}
                onClose={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByTestId('repo-picker-filter'), { target: { value: 'missing' } });
        expect(screen.getByText('No repos found')).toBeTruthy();
    });
});
