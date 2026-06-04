import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'src',
    'server',
    'spa',
    'client',
    'react',
    'features',
    'git',
    'CrossCloneCherryPickModal.tsx',
);

describe('CrossCloneCherryPickModal', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
    });

    it('loads current-CoC registered workspaces, remote CoC targets, and git-info in batch', () => {
        expect(source).toContain('listWorkspaces()');
        expect(source).toContain('getWorkspaceGitInfoBatch');
        expect(source).toContain('listRemoteWorkspaceTargetSources');
        expect(source).toContain('remoteTargetResult.sources');
    });

    it('uses the shared target grouping utility', () => {
        expect(source).toContain('buildCrossCloneCherryPickTargetGroupsFromSources');
        expect(source).toContain('targetGroups.map');
    });

    it('exports from the source workspace and applies directly to local target workspaces', () => {
        expect(source).toContain('selectedTarget.server.local');
        expect(source).toContain('exportCommitPatch(sourceWorkspaceId, commit.hash)');
        expect(source).toContain('applyCommitPatch(selectedTarget.workspace.id');
        expect(source).toContain('patch: exported.patch');
    });

    it('carries sanitized source metadata through the apply request', () => {
        expect(source).toContain('sourceWorkspace: exported.sourceWorkspace');
        expect(source).toContain('sourceCommit: exported.sourceCommit');
        expect(source).toContain('normalizedSourceRemoteUrl: exported.normalizedSourceRemoteUrl');
    });

    it('uses the initiating server orchestrator for remote CoC targets', () => {
        expect(source).toContain('servers.cherryPickTransfer');
        expect(source).toContain('serverId: LOCAL_COC_SERVER_ID');
        expect(source).toContain('serverId: selectedTarget.server.id');
        expect(source).toContain('setResult(response.result)');
    });

    it('uses server-aware target keys and labels so duplicate remote workspaces are distinguishable', () => {
        expect(source).toContain('selectedTargetKey');
        expect(source).toContain('value={target.key}');
        expect(source).toContain('{target.server.label}');
        expect(source).toContain('Server: {selectedTarget.server.label}');
    });

    it('requires explicit confirmation for cross-remote targets before applying', () => {
        expect(source).toContain("selectedTarget?.remoteStatus === 'cross-remote'");
        expect(source).toContain('crossRemoteConfirmed');
        expect(source).toContain('source and target remotes differ');
    });

    it('requires explicit stash opt-in for dirty targets', () => {
        expect(source).toContain("selectedTarget?.gitInfo?.dirty");
        expect(source).toContain('stashAndContinue');
        expect(source).toContain('CoC will not auto-stash unless this is checked');
    });

    it('shows conflict guidance instead of claiming success', () => {
        expect(source).toContain('body.conflicts === true');
        expect(source).toContain('Resolve locally, then continue or abort');
    });
});
