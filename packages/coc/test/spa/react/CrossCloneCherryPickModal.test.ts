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

    it('loads current-CoC registered workspaces and git-info in batch', () => {
        expect(source).toContain('listWorkspaces()');
        expect(source).toContain('getWorkspaceGitInfoBatch');
    });

    it('uses the shared target grouping utility', () => {
        expect(source).toContain('buildCrossCloneCherryPickTargetGroups');
        expect(source).toContain('targetGroups.map');
    });

    it('exports from the source workspace and applies to the selected target workspace', () => {
        expect(source).toContain('exportCommitPatch(sourceWorkspaceId, commit.hash)');
        expect(source).toContain('applyCommitPatch(selectedTarget.workspace.id');
        expect(source).toContain('patch: exported.patch');
    });

    it('carries sanitized source metadata through the apply request', () => {
        expect(source).toContain('sourceWorkspace: exported.sourceWorkspace');
        expect(source).toContain('sourceCommit: exported.sourceCommit');
        expect(source).toContain('normalizedSourceRemoteUrl: exported.normalizedSourceRemoteUrl');
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
