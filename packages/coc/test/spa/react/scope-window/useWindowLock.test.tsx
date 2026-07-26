/**
 * useEnforceWindowLock (AC-02) — boot enforcement for a locked pop-out window.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

let mockLockedId: string | null = null;
let mockWorkspaces: any[] = [];

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: mockWorkspaces }, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/features/scope-window/scopeWindow', () => ({
    readLockedWorkspaceId: () => mockLockedId,
}));

import { useEnforceWindowLock } from '../../../../src/server/spa/client/react/features/scope-window/useWindowLock';

function Harness() {
    useEnforceWindowLock();
    return null;
}

beforeEach(() => {
    mockLockedId = null;
    mockWorkspaces = [];
    window.location.hash = '';
    document.title = 'CoC';
});

afterEach(() => {
    window.location.hash = '';
});

describe('useEnforceWindowLock', () => {
    it('does nothing in an unlocked window', () => {
        render(<Harness />);
        expect(window.location.hash).toBe('');
        expect(document.title).toBe('CoC');
    });

    it('forces the hash onto the locked scope on boot', () => {
        mockLockedId = 'ws-v2-abc';
        render(<Harness />);
        expect(window.location.hash).toBe('#repos/ws-v2-abc');
    });

    it('sets the window title to the scope display name once workspaces resolve', () => {
        mockLockedId = 'ws-v2-abc';
        mockWorkspaces = [{ id: 'ws-v2-abc', name: 'shortcuts' }];
        render(<Harness />);
        expect(document.title).toBe('shortcuts');
    });

    it('falls back to the id for the title until the workspace resolves', () => {
        mockLockedId = 'my_work';
        render(<Harness />);
        expect(document.title).toBe('my_work');
        expect(window.location.hash).toBe('#repos/my_work');
    });

    it('re-pins the hash when it drifts to another scope', () => {
        mockLockedId = 'ws-v2-abc';
        render(<Harness />);
        expect(window.location.hash).toBe('#repos/ws-v2-abc');

        window.location.hash = '#repos/ws-v2-other/git';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        expect(window.location.hash).toBe('#repos/ws-v2-abc');
    });
});
