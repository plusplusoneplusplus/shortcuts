import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { resolveRepoGroupRelativeFileTargets } from '../../src/server/tasks/tasks-handler-utils';

describe('repo-group relative file targets', () => {
    it.each(['wsl$', 'wsl.localhost'])('resolves WSL sibling paths on %s without losing the share or owner', host => {
        const share = `\\\\${host}\\Ubuntu`;
        const source = { workspaceId: 'source', rootPath: `${share}\\home\\user\\fuse` };
        const target = { workspaceId: 'target', rootPath: `${share}\\home\\user\\3FS` };
        const other = { workspaceId: 'other', rootPath: `${share}\\opt\\other` };
        const targets = resolveRepoGroupRelativeFileTargets(
            '../3FS/src/fuse/IovTable.cc', [other, source, target], true,
        );
        expect(targets).toEqual([
            { member: target, path: `${target.rootPath}\\src\\fuse\\IovTable.cc` },
            { member: target, path: `${target.rootPath}\\src\\fuse\\IovTable.cc` },
        ]);
    });

    it('does not authorize an unregistered sibling or a prefix-only match', () => {
        const root = '\\\\wsl$\\Ubuntu\\home\\user\\repo';
        const roots = [{ workspaceId: 'member', rootPath: root }];
        expect(resolveRepoGroupRelativeFileTargets('../unregistered/secret', roots, true)).toEqual([]);
        expect(resolveRepoGroupRelativeFileTargets('../repo-other/secret', roots, true)).toEqual([]);
    });

    it('does not confuse identical Linux paths in different WSL distributions', () => {
        const source = { workspaceId: 'source', rootPath: '\\\\wsl$\\Ubuntu\\home\\user\\source' };
        const target = { workspaceId: 'target', rootPath: '\\\\wsl$\\Debian\\home\\user\\target' };
        expect(resolveRepoGroupRelativeFileTargets('../target/a.cc', [source, target], true)).toEqual([
            { member: target, path: `${target.rootPath}\\a.cc` },
        ]);
    });

    it('attributes overlapping roots to the most specific member', () => {
        const parent = { workspaceId: 'parent', rootPath: path.resolve('fixture') };
        const child = { workspaceId: 'child', rootPath: path.join(parent.rootPath, 'nested') };
        const targets = resolveRepoGroupRelativeFileTargets('nested/a.ts', [parent, child]);
        expect(targets[0]).toEqual({ member: child, path: path.join(child.rootPath, 'a.ts') });
    });

    it('preserves member order for ordinary relative paths', () => {
        const roots = ['first', 'second'].map(workspaceId => ({
            workspaceId, rootPath: path.resolve('fixture', workspaceId),
        }));
        expect(resolveRepoGroupRelativeFileTargets('src/a.ts', roots)).toEqual(
            roots.map(member => ({ member, path: path.join(member.rootPath, 'src', 'a.ts') })),
        );
        expect(resolveRepoGroupRelativeFileTargets('src/a.ts', [])).toEqual([]);
    });
});
