import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SkillFilePreview } from '../../../../src/server/spa/client/react/features/skills/SkillFilePreview';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

const skill = {
    name: 'review',
    description: 'Review changes',
    promptBody: 'Review the diff.',
    references: ['rules.md'],
};

describe('SkillFilePreview', () => {
    it('does not let a previous workspace file response replace the active preview', async () => {
        const oldFile = deferred<any>();
        const newFile = deferred<any>();
        const loadFile = vi.fn()
            .mockReturnValueOnce(oldFile.promise)
            .mockReturnValueOnce(newFile.promise);
        const { rerender } = render(
            <SkillFilePreview
                workspaceId="old"
                skill={skill}
                detail={null}
                detailLoading={false}
                detailError={null}
                isOpen={true}
                sourceLabel="repo"
                loadFile={loadFile}
            />,
        );
        fireEvent.click(screen.getByTestId('skill-file-row-references/rules.md'));

        rerender(
            <SkillFilePreview
                workspaceId="new"
                skill={skill}
                detail={null}
                detailLoading={false}
                detailError={null}
                isOpen={true}
                sourceLabel="repo"
                loadFile={loadFile}
            />,
        );
        fireEvent.click(screen.getByTestId('skill-file-row-references/rules.md'));
        await act(async () => {
            newFile.resolve({ path: 'rules.md', content: 'new workspace', size: 13 });
            await newFile.promise;
        });
        await waitFor(() => expect(screen.getByTestId('skill-file-content').textContent).toBe('new workspace'));

        await act(async () => {
            oldFile.resolve({ path: 'rules.md', content: 'old workspace', size: 13 });
            await oldFile.promise;
        });

        expect(screen.getByTestId('skill-file-content').textContent).toBe('new workspace');
    });

    it('drops a pending file response when the card closes', async () => {
        const pending = deferred<any>();
        const loadFile = vi.fn().mockReturnValue(pending.promise);
        const { rerender } = render(
            <SkillFilePreview workspaceId="ws" skill={skill} detail={null} detailLoading={false} detailError={null} isOpen={true} sourceLabel="repo" loadFile={loadFile} />,
        );
        fireEvent.click(screen.getByTestId('skill-file-row-references/rules.md'));

        rerender(
            <SkillFilePreview workspaceId="ws" skill={skill} detail={null} detailLoading={false} detailError={null} isOpen={false} sourceLabel="repo" loadFile={loadFile} />,
        );
        await act(async () => {
            pending.resolve({ path: 'rules.md', content: 'late content', size: 12 });
            await pending.promise;
        });
        rerender(
            <SkillFilePreview workspaceId="ws" skill={skill} detail={null} detailLoading={false} detailError={null} isOpen={true} sourceLabel="repo" loadFile={loadFile} />,
        );

        expect(screen.queryByTestId('skill-file-content')).toBeNull();
        expect(screen.getByText('Review the diff.')).toBeTruthy();
    });

    it('shows file and detail errors inline while preserving metadata', async () => {
        const loadFile = vi.fn().mockRejectedValue(new Error('file unavailable'));
        render(
            <SkillFilePreview workspaceId="ws" skill={skill} detail={null} detailLoading={false} detailError="detail unavailable" isOpen={true} sourceLabel="repo" loadFile={loadFile} />,
        );

        fireEvent.click(screen.getByTestId('skill-file-row-references/rules.md'));

        await waitFor(() => expect(screen.getByTestId('skill-file-error').textContent).toBe('file unavailable'));
        expect(screen.getByTestId('skill-detail-error').textContent).toBe('detail unavailable');
        expect(screen.getByText('Source')).toBeTruthy();
    });
});
