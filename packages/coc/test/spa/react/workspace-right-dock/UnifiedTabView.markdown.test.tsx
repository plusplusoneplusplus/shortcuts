// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { UnifiedTabView } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTabView';
import type { UnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    _resetRuntimeConfig,
    applyRuntimeConfigPatch,
} from '../../../../src/server/spa/client/react/utils/config';

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ repoId, routingRef, filePath, markdownPreview, revealLine }: {
        repoId: string;
        routingRef?: string | null;
        filePath: string;
        markdownPreview?: boolean;
        revealLine?: number;
    }) => (
        <div data-testid="panel-file" data-repo={repoId} data-route={routingRef}
            data-path={filePath} data-preview={String(markdownPreview)} data-line={revealLine} />
    ),
}));

const file: UnifiedPanelTab = {
    id: 'file-1',
    kind: 'file',
    ownerWorkspaceId: 'ws-member',
    ownerRoutingRef: 'remote:member',
    chatId: 'chat-1',
    resourceId: 'README.md',
    label: 'README.md',
};

describe('unified Markdown file-tab opt-in', () => {
    beforeEach(() => _resetRuntimeConfig());

    it('defaults off, reacts to live config changes, and retains the concrete file owner', () => {
        render(<UnifiedTabView tab={file} scopeWorkspaceId="ws-group" onClose={vi.fn()} />);
        const view = screen.getByTestId('panel-file');
        expect(view).toHaveAttribute('data-preview', 'false');
        expect(view).toHaveAttribute('data-repo', 'ws-member');
        expect(view).toHaveAttribute('data-route', 'remote:member');
        act(() => applyRuntimeConfigPatch({ markdownPanelPreviewEnabled: true }));
        expect(view).toHaveAttribute('data-preview', 'true');
        act(() => applyRuntimeConfigPatch({ markdownPanelPreviewEnabled: false }));
        expect(view).toHaveAttribute('data-preview', 'false');
    });

    it('forwards repeat line navigation on the same file without replacing its view', () => {
        applyRuntimeConfigPatch({ markdownPanelPreviewEnabled: true });
        const { rerender } = render(
            <UnifiedTabView tab={file} scopeWorkspaceId="ws-group" onClose={vi.fn()} />,
        );
        const view = screen.getByTestId('panel-file');
        rerender(<UnifiedTabView tab={{ ...file, line: 12, revealNonce: 2 }}
            scopeWorkspaceId="ws-group" onClose={vi.fn()} />);
        expect(screen.getByTestId('panel-file')).toBe(view);
        expect(view).toHaveAttribute('data-line', '12');
        expect(view).toHaveAttribute('data-preview', 'true');
    });
});
