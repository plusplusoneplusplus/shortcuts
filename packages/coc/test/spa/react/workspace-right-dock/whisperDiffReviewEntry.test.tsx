/**
 * The chat's changed-files entry points into the unified panel's
 * "N files changed" tab: the popover footer (whole group, no focus) and a file
 * row (`focusPath`) both file the same `diff` tab through
 * `whisperDiffTabInput`, and `UnifiedDiffTab` renders it in the shared review
 * navigator with the captured snapshot — scoped to the clone that owns it.
 */
/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffEngine', () => ({
    useDiffEngine: () => ['monaco', () => {}],
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/MonacoFileDiffViewer', () => ({
    MonacoFileDiffViewer: (props: any) => (
        <div data-testid={props['data-testid']} data-workspace={props.workspaceId} data-model={props.modelIdentity}>
            <pre data-testid="monaco-original">{props.original}</pre>
            <pre data-testid="monaco-modified">{props.modified}</pre>
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, 'data-testid': testId }: any) => <pre data-testid={testId}>{diff}</pre>,
}));

import type { WhisperDiffOpenContext } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import { collectFileEdits } from '../../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';
import { clearUnifiedDiffSources, whisperDiffTabInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedDiffSources';
import { UnifiedDiffTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedDiffTab';

const ROOT = '/home/u/proj';
const CALLS = [
    { toolName: 'create', args: { path: `${ROOT}/src/file-viewer/Reload.tsx`, file_text: 'export const x = 1;\n' } },
    { toolName: 'edit', args: { path: `${ROOT}/src/explorer/Preview.test.tsx`, old_str: 'old', new_str: 'new' } },
];

function groupContext(over: Partial<WhisperDiffOpenContext> = {}): WhisperDiffOpenContext {
    return { files: collectFileEdits(CALLS), toolCalls: CALLS, commits: [], workspaceId: 'repo-a', ...over };
}

function openTab(ctx: WhisperDiffOpenContext) {
    const input = whisperDiffTabInput({ ctx, ownerWorkspaceId: ctx.workspaceId ?? 'repo-a', chatId: 'chat-1', workspaceRootPath: ROOT });
    return input;
}

function renderTab(input: ReturnType<typeof openTab>) {
    return render(
        <UnifiedDiffTab sourceId={input.resourceId} label={input.label} scopeWorkspaceId="repo-a" chatId="chat-1" onClose={() => {}} />,
    );
}

const nav = () => screen.getByRole('complementary', { name: 'Changed files' });
const rowPaths = () => Array.from(nav().querySelectorAll('[data-file-path]')).map(el => el.getAttribute('data-file-path'));
const selectedPath = () => nav().querySelector('[aria-current="true"]')?.getAttribute('data-file-path');

beforeEach(() => {
    cleanup();
    clearUnifiedDiffSources();
    localStorage.clear();
});

describe('changed-files entry points → shared review tab', () => {
    it('the "N files" footer opens the whole set on its first file, with the existing tab title', () => {
        const input = openTab(groupContext());
        expect(input.label).toBe('2 files changed');
        renderTab(input);
        expect(rowPaths()).toEqual(['src/explorer/Preview.test.tsx', 'src/file-viewer/Reload.tsx']);
        expect(selectedPath()).toBe('src/explorer/Preview.test.tsx');
        expect(screen.getByTestId('whisper-diff-patch-only')).toBeInTheDocument();
    });

    it('a file row opens the same tab focused on that file, in Monaco with its captured sides', () => {
        const footer = openTab(groupContext());
        const row = openTab(groupContext({ focusPath: `${ROOT}/src/file-viewer/Reload.tsx` }));
        expect(row.resourceId).toBe(footer.resourceId);
        renderTab(row);
        expect(selectedPath()).toBe('src/file-viewer/Reload.tsx');
        expect(screen.getByTestId('monaco-original').textContent).toBe('');
        expect(screen.getByTestId('monaco-modified').textContent).toBe('export const x = 1;\n');
    });

    it('clicking another row in the open tab selects it', () => {
        renderTab(openTab(groupContext({ focusPath: `${ROOT}/src/file-viewer/Reload.tsx` })));
        fireEvent.click(nav().querySelector('[data-file-path="src/explorer/Preview.test.tsx"]')!);
        expect(selectedPath()).toBe('src/explorer/Preview.test.tsx');
        // A snippet edit opens in the shared Monaco editor as the snippet only.
        expect(screen.getByTestId('whisper-diff-patch-only')).toBeInTheDocument();
        expect(screen.getByTestId('monaco-modified').textContent?.split('\n')).toContain('new');
        expect(screen.queryByTestId('whisper-diff-viewer')).toBeNull();
    });

    it('keeps a remote clone\'s snapshot in its own tab and editor models', () => {
        const local = openTab(groupContext({ focusPath: `${ROOT}/src/file-viewer/Reload.tsx` }));
        const remote = openTab(groupContext({ focusPath: `${ROOT}/src/file-viewer/Reload.tsx`, workspaceId: 'remote:srv-b:repo-a' }));
        expect(remote.resourceId).not.toBe(local.resourceId);
        expect(remote.ownerWorkspaceId).toBe('remote:srv-b:repo-a');
        renderTab(remote);
        expect(screen.getByTestId('whisper-diff-editor')).toHaveAttribute('data-workspace', 'remote:srv-b:repo-a');
    });
});
