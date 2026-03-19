import { describe, it, expect } from 'vitest';
import {
    resolveWorkspaceName,
    getProcessWorkspaceId,
    getProcessWorkspaceName,
} from '../../../../src/server/spa/client/react/utils/workspace';

const workspaces = [
    { id: 'ws-1', name: 'Project A', path: '/home/user/project-a' },
    { id: 'ws-2', name: 'Project B', path: '/home/user/project-b' },
];

describe('resolveWorkspaceName', () => {
    it('returns workspace name from workspaces array when id matches', () => {
        expect(resolveWorkspaceName('ws-1', null, workspaces)).toBe('Project A');
    });

    it('falls back to workspaceName argument when id not found in array', () => {
        expect(resolveWorkspaceName('ws-99', 'Fallback Name', workspaces)).toBe('Fallback Name');
    });

    it('falls back to workspaceId when id not found and no workspaceName', () => {
        expect(resolveWorkspaceName('ws-99', null, workspaces)).toBe('ws-99');
    });

    it('returns null when workspaceId is null', () => {
        expect(resolveWorkspaceName(null, 'ignored', workspaces)).toBeNull();
    });

    it('returns null when workspaceId is undefined', () => {
        expect(resolveWorkspaceName(undefined, 'ignored', workspaces)).toBeNull();
    });

    it('returns null when workspaceId is empty string', () => {
        expect(resolveWorkspaceName('', 'ignored', workspaces)).toBeNull();
    });

    it('works correctly with empty workspaces array', () => {
        expect(resolveWorkspaceName('ws-1', 'My Name', [])).toBe('My Name');
    });

    it('works with empty workspaces array and no workspaceName', () => {
        expect(resolveWorkspaceName('ws-1', null, [])).toBe('ws-1');
    });
});

describe('getProcessWorkspaceId', () => {
    it('returns top-level workspaceId', () => {
        expect(getProcessWorkspaceId({ workspaceId: 'ws-1' })).toBe('ws-1');
    });

    it('returns workspaceId from metadata when top-level is absent', () => {
        expect(getProcessWorkspaceId({ metadata: { workspaceId: 'ws-meta' } })).toBe('ws-meta');
    });

    it('prefers top-level workspaceId over metadata', () => {
        expect(getProcessWorkspaceId({ workspaceId: 'ws-top', metadata: { workspaceId: 'ws-meta' } })).toBe('ws-top');
    });

    it('returns null when no workspaceId found', () => {
        expect(getProcessWorkspaceId({ metadata: {} })).toBeNull();
    });

    it('returns null for null process', () => {
        expect(getProcessWorkspaceId(null)).toBeNull();
    });

    it('returns null for undefined process', () => {
        expect(getProcessWorkspaceId(undefined)).toBeNull();
    });
});

describe('getProcessWorkspaceName', () => {
    it('returns top-level workspaceName', () => {
        expect(getProcessWorkspaceName({ workspaceName: 'My Project' })).toBe('My Project');
    });

    it('returns workspaceName from metadata when top-level is absent', () => {
        expect(getProcessWorkspaceName({ metadata: { workspaceName: 'Meta Project' } })).toBe('Meta Project');
    });

    it('prefers top-level workspaceName over metadata', () => {
        expect(getProcessWorkspaceName({ workspaceName: 'Top', metadata: { workspaceName: 'Meta' } })).toBe('Top');
    });

    it('returns null when no workspaceName found', () => {
        expect(getProcessWorkspaceName({})).toBeNull();
    });

    it('returns null for null process', () => {
        expect(getProcessWorkspaceName(null)).toBeNull();
    });
});
