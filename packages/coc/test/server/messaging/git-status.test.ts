import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadNativeGit } from '@plusplusoneplusplus/coc-native';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { localGitStatusReply, readMessagingGitStatus, type MessagingGitStatus } from '../../../src/server/messaging/git-status';
import { handleMessagingCommand } from '../../../src/server/messaging/messaging-commands';

const clean = (): MessagingGitStatus => ({
    branch: { branch: 'main', isDetached: false, dirty: false, ahead: 8, behind: 2, trackingBranch: 'origin/main', unborn: false },
    entries: [], conflicts: 0, trackingAvailable: true,
});

describe('local messaging Git status', () => {
    let dir: string;
    const workspace = (id: string, virtual = false): WorkspaceInfo => ({
        id, name: id, rootPath: path.join(dir, id), virtual,
    });
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-git-')); });
    afterEach(() => { vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('expands groups only inside the supplied local access scope and deduplicates roots', async () => {
        const a = workspace('alpha'), b = workspace('beta');
        const groups = [workspace('group-one', true), workspace('group-two', true)];
        for (const group of groups) {
            const root = path.join(dir, 'repos', group.id);
            fs.mkdirSync(root, { recursive: true });
            fs.writeFileSync(path.join(root, 'group.json'), JSON.stringify({
                name: group.name, members: ['alpha', 'beta', 'private-repo', 'remote:server:repo'],
            }));
        }
        const read = vi.fn().mockResolvedValue(clean());
        const reply = await localGitStatusReply([
            ...groups, a, b, { ...a, id: 'alias', name: 'Alias' },
            workspace('global', true), workspace('remote:server:repo'),
        ], dir, read);
        expect(read.mock.calls).toEqual([[a.rootPath], [b.rootPath]]);
        expect(reply).toContain('local repos (2)');
        expect(reply).toBe('Git status - local repos (2)\n\nalpha - clean\nbeta - clean');
        expect(reply).not.toMatch(/private-repo|remote:|Alias|global|group-one|group-two/);
    });

    it('reports counts separately from unresolved conflicts, without filenames or tables', async () => {
        const read = vi.fn().mockResolvedValue({
            ...clean(), conflicts: 2,
            entries: [
                { path: 'both.txt', status: 'modified', stage: 'staged' },
                { path: 'both.txt', status: 'modified', stage: 'unstaged' },
                { path: 'renamed.txt', originalPath: 'old.txt', status: 'renamed', stage: 'staged' },
                { path: 'new.txt', status: 'untracked', stage: 'untracked' },
            ],
        });
        const reply = await localGitStatusReply([workspace('alpha')], dir, read);
        expect(reply).toContain('alpha - 2 staged, 1 unstaged, 1 untracked, 2 conflicts');
        expect(reply).not.toMatch(/both.txt|old.txt|\|/);
    });

    it('renders one row per repo: clean without branch/tracking clutter, otherwise only nonzero counts', async () => {
        const read = vi.fn()
            .mockResolvedValueOnce({ ...clean(), branch: { ...clean().branch, isDetached: true, trackingBranch: undefined } })
            .mockResolvedValueOnce({ ...clean(), branch: { ...clean().branch, unborn: true, trackingBranch: undefined } })
            .mockResolvedValueOnce({ ...clean(), trackingAvailable: false })
            .mockResolvedValueOnce({ ...clean(), entries: [{ path: 'a', status: 'untracked', stage: 'untracked' }] })
            .mockResolvedValueOnce({ ...clean(), conflicts: 1 })
            .mockResolvedValueOnce({ ...clean(), conflicts: 3, entries: [{ path: 'b', status: 'modified', stage: 'unstaged' }] });
        const reply = await localGitStatusReply(
            ['detached', 'unborn', 'gone', 'dirty', 'conflicted', 'mixed'].map(id => workspace(id)), dir, read);
        expect(reply).toBe([
            'Git status - local repos (6)', '',
            'detached - clean', 'unborn - clean', 'gone - clean', 'dirty - 1 untracked',
            'conflicted - 1 conflict', 'mixed - 1 unstaged, 3 conflicts',
        ].join('\n'));
        expect(reply).not.toMatch(/main|ahead|behind|upstream|0 |fetch/);
    });

    it('isolates status failures and reports missing paths, non-Git roots and unreadable groups', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const read = vi.fn()
            .mockRejectedValueOnce(new Error('fatal: not a git repository'))
            .mockRejectedValueOnce(new Error('ENOENT sensitive path'))
            .mockRejectedValueOnce(new Error('unexpected sensitive output'))
            .mockResolvedValueOnce(clean());
        const reply = await localGitStatusReply([
            workspace('plain'), workspace('missing'), workspace('failed'), workspace('good'),
            { ...workspace('no-path'), rootPath: '' }, workspace('group-broken', true),
        ], dir, read);
        expect(reply).toContain('plain: not a Git repository');
        expect(reply).toContain('missing: repository unavailable');
        expect(reply).toContain('failed: status failed');
        expect(reply).toContain('good - clean');
        expect(reply).toContain('no-path: repository path unavailable');
        expect(reply).toContain('group-broken: group membership unavailable');
        expect(reply).not.toContain('sensitive');
    });

    it('handles empty registries and uses shared escaping without selecting a repo or invoking AI', async () => {
        expect(await localGitStatusReply([])).toContain('No accessible local repos registered.');
        const selection = { repoId: vi.fn(), selectRepo: vi.fn(), topicId: vi.fn(), selectTopic: vi.fn() };
        const getAllProcesses = vi.fn(), getProcess = vi.fn();
        const reply = await handleMessagingCommand({ type: 'git-status', args: '' }, {
            store: { getWorkspaces: async () => [workspace('<repo>')], getAllProcesses, getProcess },
            selection, readGitStatus: async () => clean(), escape: text => text.replace(/</g, '&lt;'),
        });
        expect(reply).toContain('&lt;repo>');
        for (const fn of [...Object.values(selection), getAllProcesses, getProcess]) expect(fn).not.toHaveBeenCalled();
    });

    it('reads real Git counts and tracking refs without changing index, config, refs or fetching', async () => {
        const repo = workspace('repo');
        fs.mkdirSync(repo.rootPath);
        const git = (...args: string[]) => execFileSync('git', ['-C', repo.rootPath, ...args], { encoding: 'utf8' }).trim();
        git('init', '-b', 'main');
        fs.writeFileSync(path.join(repo.rootPath, 'tracked.txt'), 'initial\n');
        git('add', '.');
        git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
        git('config', 'remote.origin.url', 'https://example.invalid/repo.git');
        git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
        git('config', 'branch.main.remote', 'origin');
        git('config', 'branch.main.merge', 'refs/heads/main');
        const tree = git('rev-parse', 'HEAD^{tree}');
        const next = git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', tree, '-p', 'HEAD', '-m', 'next');
        git('update-ref', 'refs/heads/main', next);
        fs.writeFileSync(path.join(repo.rootPath, 'tracked.txt'), 'staged\n');
        git('add', 'tracked.txt');
        fs.writeFileSync(path.join(repo.rootPath, 'tracked.txt'), 'unstaged\n');
        fs.mkdirSync(path.join(repo.rootPath, 'new'));
        fs.writeFileSync(path.join(repo.rootPath, 'new', 'a.txt'), 'untracked');
        fs.writeFileSync(path.join(repo.rootPath, 'new', 'b.txt'), 'untracked');
        const indexPath = path.join(repo.rootPath, '.git', 'index');
        const index = fs.readFileSync(indexPath);
        const config = fs.readFileSync(path.join(repo.rootPath, '.git', 'config'));
        const refs = git('show-ref');
        const addon = loadNativeGit();
        const exec = vi.spyOn(addon, 'execGit');
        const reply = await localGitStatusReply([repo]);
        expect(reply).toContain('repo - 1 staged, 1 unstaged, 2 untracked');
        expect(reply).not.toMatch(/conflict|ahead|behind/);
        expect(exec.mock.calls.map(call => call[0])).toEqual([
            ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--untracked-files=all'],
            ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all'],
        ]);
        expect(fs.readFileSync(indexPath)).toEqual(index);
        expect(fs.readFileSync(path.join(repo.rootPath, '.git', 'config'))).toEqual(config);
        expect(git('show-ref')).toBe(refs);
        git('update-ref', '-d', 'refs/remotes/origin/main');
        expect((await readMessagingGitStatus(repo.rootPath)).trackingAvailable).toBe(false);
        git('config', '--remove-section', 'branch.main');
        expect((await readMessagingGitStatus(repo.rootPath)).branch.trackingBranch).toBeUndefined();
        git('update-ref', '--no-deref', 'HEAD', next);
        expect((await readMessagingGitStatus(repo.rootPath)).branch.isDetached).toBe(true);
    });

    it('counts all seven unmerged statuses once, using existing parsers for ordinary changes', async () => {
        const addon = loadNativeGit();
        const codes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'];
        vi.spyOn(addon, 'execGit')
            .mockResolvedValueOnce('# branch.oid (initial)\n# branch.head main\n' + codes.map(code => `u ${code} conflict-${code}`).join('\n'))
            .mockResolvedValueOnce(codes.map(code => `${code} conflict-${code}`).join('\n') + '\nMM both\n?? new');
        const status = await readMessagingGitStatus(dir);
        expect(status.conflicts).toBe(7);
        expect(status.entries.map(entry => entry.stage)).toEqual(['staged', 'unstaged', 'untracked']);
        expect(status.entries.every(entry => !entry.path.startsWith('conflict'))).toBe(true);
    });

    it('reports real unborn, non-Git and unavailable registered roots without blocking the reply', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const unborn = workspace('unborn'), plain = workspace('plain'), missing = workspace('missing');
        fs.mkdirSync(unborn.rootPath);
        fs.mkdirSync(plain.rootPath);
        execFileSync('git', ['-C', unborn.rootPath, 'init', '-b', 'main']);
        const reply = await localGitStatusReply([plain, missing, unborn]);
        expect(reply).toContain('plain: not a Git repository');
        expect(reply).toContain('missing: repository unavailable');
        expect(reply).toContain('unborn - clean');
    });

    it('counts staged and unstaged type changes rather than reporting a dirty repo as clean', async () => {
        const addon = loadNativeGit();
        vi.spyOn(addon, 'execGit')
            .mockResolvedValueOnce('# branch.oid abc\n# branch.head main\n1 T. type-index\n1 .T type-worktree')
            .mockResolvedValueOnce('T  type-index\n T type-worktree');
        const status = await readMessagingGitStatus(dir);
        expect(status.entries.map(entry => entry.stage)).toEqual(['staged', 'unstaged']);
        expect(await localGitStatusReply([workspace('types')], dir, async () => status))
            .toContain('types - 1 staged, 1 unstaged');
    });
});
