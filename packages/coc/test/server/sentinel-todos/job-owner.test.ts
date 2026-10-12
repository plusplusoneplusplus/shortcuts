/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import type { SentinelTodoJobLink } from '@plusplusoneplusplus/coc-client';
import {
    resolveSentinelTodoJobOwner,
    type SentinelTodoOwnerWorkspace,
} from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoJobOwner';

const owner = { ownerWorkspaceId: 'repo1', processId: 'sentinel', ownerRoutingRef: null };
const job: SentinelTodoJobLink = {
    workspaceId: 'repo1', processId: 'job', kind: 'local', openLink: '#repos/repo1/chats/job',
    linkedAt: '2026-10-11T00:00:00.000Z', execution: { state: 'running' },
};
const workspaces: SentinelTodoOwnerWorkspace[] = [
    { id: 'repo1', name: 'shortcuts' },
    { id: 'repo2', name: 'shortcuts-2' },
    { id: 'repo1', name: 'remote-checkout', remote: { serverId: 'server-a', serverLabel: 'Build machine' } },
    { id: 'repo1', name: 'other-checkout', remote: { serverId: 'server-b', serverLabel: 'Test machine' } },
    { id: 'group-review', name: 'Review group', remote: { serverId: 'server-a', serverLabel: 'Build machine' } },
];
const resolve = (overrides: Partial<Parameters<typeof resolveSentinelTodoJobOwner>[0]> = {}) =>
    resolveSentinelTodoJobOwner({ job, owner, workspaces, ...overrides });

describe('Sentinel linked-job owner labels', () => {
    it('omits the current local repo, even when remote workspace ids collide', () => {
        expect(resolve()).toMatchObject({ label: 'shortcuts', showBadge: false });
    });
    it('shows the actual other local clone, not the item target', () => {
        expect(resolve({ job: { ...job, workspaceId: 'repo2' }, targetRepo: { workspaceId: 'repo1', label: 'Wrong target' } }))
            .toMatchObject({ label: 'shortcuts-2', showBadge: true });
    });
    it('qualifies remote owners with the configured server label, not an SSH host', () => {
        expect(resolve({ job: { ...job, kind: 'remote', serverId: 'server-a' } }))
            .toMatchObject({ label: 'Build machine / remote-checkout', showBadge: true });
    });
    it('omits only the exact current remote repo, not the same workspace on another server', () => {
        const currentWorkspaceId = 'remote:server-a:repo1';
        expect(resolve({ job: { ...job, serverId: 'server-a', kind: 'remote' }, currentWorkspaceId }).showBadge).toBe(false);
        expect(resolve({ job: { ...job, serverId: 'server-b', kind: 'remote' }, currentWorkspaceId }))
            .toMatchObject({ label: 'Test machine / other-checkout', showBadge: true });
    });
    it('resolves ledger-relative members on a remote group server', () => {
        const groupOwner = { ...owner, ownerWorkspaceId: 'group-review', ownerRoutingRef: 'remote:server-a:group-review' };
        expect(resolve({ owner: groupOwner, currentWorkspaceId: groupOwner.ownerRoutingRef }))
            .toMatchObject({ label: 'Build machine / remote-checkout', showBadge: true });
    });
    it('shows concrete members when the current scope is a local group', () => {
        expect(resolve({ owner: { ...owner, ownerWorkspaceId: 'group-review' }, currentWorkspaceId: 'group-review' }))
            .toMatchObject({ label: 'shortcuts', showBadge: true });
    });
    it('resolves remote group display names through the same directory', () => {
        expect(resolve({ job: { ...job, workspaceId: 'group-review', serverId: 'server-a', kind: 'remote' } }).label)
            .toBe('Build machine / Review group');
    });
    it('keeps cached offline names with an accessible metadata explanation', () => {
        const offline = workspaces.map(ws => ws.remote ? { ...ws, remote: { ...ws.remote, offline: true, connection: 'offline' } } : ws);
        const result = resolve({ job: { ...job, kind: 'remote', serverId: 'server-a' }, workspaces: offline });
        expect(result.label).toBe('Build machine / remote-checkout');
        expect(result.description).toContain('Server offline; showing last-known metadata');
    });
    it('keeps a known server label when its workspace is missing', () => {
        const result = resolve({ job: { ...job, workspaceId: 'missing', serverId: 'server-a', kind: 'remote' } });
        expect(result.label).toBe('Build machine / Unknown repo');
        expect(result.description).toContain('Workspace metadata unavailable (workspace: missing)');
    });
    it('reuses known server metadata when the matching workspace has no server label', () => {
        expect(resolve({
            job: { ...job, workspaceId: 'missing-label', serverId: 'server-a', kind: 'remote' },
            workspaces: [{ id: 'missing-label', name: 'Checkout', remote: { serverId: 'server-a' } }, ...workspaces],
        }).label).toBe('Build machine / Checkout');
    });
    it('never borrows a colliding remote workspace name for a missing local owner', () => {
        const result = resolve({ workspaces: workspaces.filter(ws => !!ws.remote) });
        expect(result.label).toBe('Unknown repo');
        expect(result.description).toContain('Local workstation / Unknown repo');
    });
    it('uses stored target labels only for an exact server-qualified owner match', () => {
        const remoteJob = { ...job, workspaceId: 'missing', serverId: 'server-a', kind: 'remote' as const };
        expect(resolve({ job: remoteJob, targetRepo: { workspaceId: 'missing', serverId: 'server-a', label: 'Saved checkout' } }).label)
            .toBe('Build machine / Saved checkout');
        for (const serverId of [undefined, 'server-b']) {
            expect(resolve({ job: remoteJob, targetRepo: { workspaceId: 'missing', serverId, label: 'Wrong checkout' } }).label)
                .toBe('Build machine / Unknown repo');
        }
    });
    it('uses ledger-relative saved labels for missing same-server members', () => {
        expect(resolve({
            job: { ...job, workspaceId: 'missing' }, owner: { ...owner, ownerRoutingRef: 'remote:server-a:repo1' },
            targetRepo: { workspaceId: 'missing', label: 'Saved member' },
        }).label).toBe('Build machine / Saved member');
    });
    it('uses honest fallback with qualified identity details for missing remote metadata', () => {
        const result = resolve({ job: { ...job, workspaceId: 'missing', kind: 'remote', serverId: 'server-missing' } });
        expect(result.label).toBe('Unknown server / Unknown repo');
        expect(result.description).toContain('(workspace: missing)');
        expect(result.description).toContain('(server: server-missing)');
    });
    it('does not infer an unqualified remote owner from the ledger or target', () => {
        expect(resolve({
            job: { ...job, kind: 'remote' }, owner: { ...owner, ownerRoutingRef: 'remote:server-a:repo1' },
            targetRepo: { workspaceId: 'repo1', serverId: 'server-a', label: 'Wrong target' },
        })).toMatchObject({ label: 'Unknown server / Unknown repo', showBadge: true });
    });
    it.each([
        'https://owner.example',
        '/private/checkouts/repo',
        'C:\\checkouts\\repo',
        'account@owner.example',
    ])(
        'rejects paths, URLs and credential-shaped labels: %s', label => {
            const result = resolve({
                job: { ...job, serverId: 'server-a', kind: 'remote' },
                workspaces: [{ id: 'repo1', name: label, remote: { serverId: 'server-a', serverLabel: label } }],
                targetRepo: { workspaceId: 'repo1', serverId: 'server-a', label },
            });
            expect(result.label).toBe('Unknown server / Unknown repo');
            expect(result.description).not.toContain(label);
        },
    );
    it('does not display raw workspace/server IDs as friendly metadata', () => {
        expect(resolve({ workspaces: [{ id: 'repo1', name: 'repo1' }] }).label).toBe('Unknown repo');
        expect(resolve({ workspaces: [], targetRepo: { workspaceId: 'repo1', label: 'repo1' } }).label).toBe('Unknown repo');
        expect(resolve({
            job: { ...job, kind: 'remote', serverId: 'server-a' },
            workspaces: [{ id: 'repo1', name: 'Checkout', remote: { serverId: 'server-a', serverLabel: 'server-a' } }],
        }).label).toBe('Unknown server / Checkout');
    });
});
