/**
 * Tests for workspace resolution utilities.
 * Covers resolveWorkspaceName, getProcessWorkspaceId, getProcessWorkspaceName.
 */

import { describe, it, expect } from 'vitest';
import {
    resolveWorkspaceName,
    getProcessWorkspaceId,
    getProcessWorkspaceName,
} from '../../../src/server/spa/client/react/utils/workspace';

describe('resolveWorkspaceName', () => {
    const workspaces = [
        { id: 'ws-abc123', name: 'my-project', rootPath: '/home/user/my-project' },
        { id: 'ws-def456', name: 'backend', rootPath: '/home/user/backend' },
    ];

    it('resolves workspace ID to name from workspaces array', () => {
        expect(resolveWorkspaceName('ws-abc123', null, workspaces)).toBe('my-project');
    });

    it('resolves second workspace correctly', () => {
        expect(resolveWorkspaceName('ws-def456', null, workspaces)).toBe('backend');
    });

    it('falls back to workspaceName when ID not found in workspaces', () => {
        expect(resolveWorkspaceName('ws-unknown', 'fallback-name', workspaces)).toBe('fallback-name');
    });

    it('falls back to raw ID when neither workspace match nor name provided', () => {
        expect(resolveWorkspaceName('ws-unknown', null, workspaces)).toBe('ws-unknown');
    });

    it('returns null when workspaceId is null', () => {
        expect(resolveWorkspaceName(null, 'some-name', workspaces)).toBeNull();
    });

    it('returns null when workspaceId is undefined', () => {
        expect(resolveWorkspaceName(undefined, 'some-name', workspaces)).toBeNull();
    });

    it('returns null when workspaceId is empty string', () => {
        expect(resolveWorkspaceName('', 'some-name', workspaces)).toBeNull();
    });

    it('works with empty workspaces array', () => {
        expect(resolveWorkspaceName('ws-abc123', 'fallback', [])).toBe('fallback');
    });

    it('prefers workspace array name over provided workspaceName', () => {
        expect(resolveWorkspaceName('ws-abc123', 'different-name', workspaces)).toBe('my-project');
    });

    it('handles workspace with empty name by falling back to workspaceName', () => {
        const wsWithEmptyName = [{ id: 'ws-empty', name: '', rootPath: '/tmp' }];
        expect(resolveWorkspaceName('ws-empty', 'fallback', wsWithEmptyName)).toBe('fallback');
    });
});

describe('getProcessWorkspaceId', () => {
    it('returns top-level workspaceId', () => {
        expect(getProcessWorkspaceId({ workspaceId: 'ws-123' })).toBe('ws-123');
    });

    it('returns metadata.workspaceId when top-level is absent', () => {
        expect(getProcessWorkspaceId({ metadata: { workspaceId: 'ws-meta' } })).toBe('ws-meta');
    });

    it('prefers top-level workspaceId over metadata', () => {
        expect(getProcessWorkspaceId({
            workspaceId: 'ws-top',
            metadata: { workspaceId: 'ws-meta' },
        })).toBe('ws-top');
    });

    it('returns null when no workspaceId present', () => {
        expect(getProcessWorkspaceId({ id: 'proc-1', status: 'running' })).toBeNull();
    });

    it('returns null for null process', () => {
        expect(getProcessWorkspaceId(null)).toBeNull();
    });

    it('returns null for undefined process', () => {
        expect(getProcessWorkspaceId(undefined)).toBeNull();
    });

    it('returns null when metadata exists but has no workspaceId', () => {
        expect(getProcessWorkspaceId({ metadata: { type: 'test' } })).toBeNull();
    });
});

describe('getProcessWorkspaceName', () => {
    it('returns top-level workspaceName', () => {
        expect(getProcessWorkspaceName({ workspaceName: 'my-project' })).toBe('my-project');
    });

    it('returns metadata.workspaceName when top-level is absent', () => {
        expect(getProcessWorkspaceName({ metadata: { workspaceName: 'meta-project' } })).toBe('meta-project');
    });

    it('prefers top-level workspaceName over metadata', () => {
        expect(getProcessWorkspaceName({
            workspaceName: 'top-name',
            metadata: { workspaceName: 'meta-name' },
        })).toBe('top-name');
    });

    it('returns null when no workspaceName present', () => {
        expect(getProcessWorkspaceName({ id: 'proc-1' })).toBeNull();
    });

    it('returns null for null process', () => {
        expect(getProcessWorkspaceName(null)).toBeNull();
    });

    it('returns null for undefined process', () => {
        expect(getProcessWorkspaceName(undefined)).toBeNull();
    });
});
