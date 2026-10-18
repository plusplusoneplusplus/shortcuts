/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RemoteShellHeader } from '../../../../src/server/spa/client/react/features/remote-shell/RemoteShellHeader';
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/WorkspaceIdentityChip', () => ({
    WorkspaceIdentityChip: () => <div data-testid="workspace-identity">Repository</div>,
}));
vi.mock('../../../../src/server/spa/client/react/features/remote-shell/WorkspaceTabsCluster', () => ({
    WorkspaceTabsCluster: () => <div data-testid="page-tabs" />,
}));
afterEach(cleanup);
describe('RemoteShellHeader', () => {
    it('renders workspace identity without a WI/PR header cluster', () => {
        render(<RemoteShellHeader repos={[]} />);
        expect(screen.getByTestId('workspace-identity')).toBeTruthy();
        expect(screen.queryByTestId('remote-scope-cluster')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });
    it('leaves identity to the scope switcher when requested', () => {
        render(<RemoteShellHeader repos={[]} hideIdentity />);
        expect(screen.queryByTestId('workspace-identity')).toBeNull();
    });
});
