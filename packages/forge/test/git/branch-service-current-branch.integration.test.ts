import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BranchService } from '../../src/git/branch-service';
import { nullLogger, setLogger } from '../../src/logger';

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

describe('BranchService current-branch-only remote operations', () => {
    let tempRoot: string;

    beforeEach(() => {
        setLogger(nullLogger);
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-current-branch-'));
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it('updates only the current upstream branch and does not auto-fetch tags', async () => {
        const origin = path.join(tempRoot, 'origin.git');
        const seed = path.join(tempRoot, 'seed');
        const consumer = path.join(tempRoot, 'consumer');

        git(tempRoot, ['init', '--bare', '--initial-branch=main', origin]);
        git(tempRoot, ['init', '--initial-branch=main', seed]);
        git(seed, ['config', 'user.name', 'CoC Test']);
        git(seed, ['config', 'user.email', 'coc-test@example.com']);
        git(seed, ['commit', '--allow-empty', '-m', 'initial']);
        git(seed, ['branch', 'sibling']);
        git(seed, ['remote', 'add', 'origin', origin]);
        git(seed, ['push', '--all', 'origin']);
        git(tempRoot, ['clone', origin, consumer]);

        const initialMain = git(consumer, ['rev-parse', 'refs/remotes/origin/main']);
        const initialSibling = git(consumer, ['rev-parse', 'refs/remotes/origin/sibling']);

        git(seed, ['commit', '--allow-empty', '-m', 'main update']);
        const updatedMain = git(seed, ['rev-parse', 'refs/heads/main']);
        const siblingParent = git(seed, ['rev-parse', 'refs/heads/sibling']);
        const siblingTree = git(seed, ['rev-parse', 'refs/heads/sibling^{tree}']);
        const updatedSibling = git(seed, ['commit-tree', siblingTree, '-p', siblingParent, '-m', 'sibling update']);
        git(seed, ['update-ref', 'refs/heads/sibling', updatedSibling]);
        git(seed, ['tag', 'new-remote-tag', updatedMain]);
        git(seed, ['push', '--all', 'origin']);
        git(seed, ['push', '--tags', 'origin']);

        expect(updatedMain).not.toBe(initialMain);
        expect(updatedSibling).not.toBe(initialSibling);

        const service = new BranchService();
        await expect(service.fetchCurrentBranch(consumer)).resolves.toEqual({ success: true });

        expect(git(consumer, ['rev-parse', 'refs/remotes/origin/main'])).toBe(updatedMain);
        expect(git(consumer, ['rev-parse', 'refs/remotes/origin/sibling'])).toBe(initialSibling);
        expect(() => git(consumer, ['show-ref', '--verify', '--quiet', 'refs/tags/new-remote-tag'])).toThrow();

        await expect(service.pullCurrentBranch(consumer, true)).resolves.toEqual({ success: true });

        expect(git(consumer, ['rev-parse', 'HEAD'])).toBe(updatedMain);
        expect(git(consumer, ['rev-parse', 'refs/remotes/origin/sibling'])).toBe(initialSibling);
        expect(() => git(consumer, ['show-ref', '--verify', '--quiet', 'refs/tags/new-remote-tag'])).toThrow();
    });
});
