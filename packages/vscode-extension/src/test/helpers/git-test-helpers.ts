/**
 * Git test helpers for creating test repositories with commits
 */

import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface GitTestRepo {
    repoPath: string;
    commits: GitCommit[];
}

export interface GitCommit {
    hash: string;
    message: string;
    files: string[];
}

/** Filesystem error codes that indicate a transiently-locked path on Windows. */
const RETRIABLE_RM_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES']);

/**
 * Windows-safe recursive removal of a throwaway temp directory.
 *
 * On Windows, `git` can keep a handle open on files inside a just-used repo for
 * a short window after `execSync` returns, so an immediate `fs.rmSync` throws
 * `EPERM`/`EBUSY` (and `force: true` only suppresses `ENOENT`, not lock errors).
 * Node's built-in `maxRetries`/`retryDelay` retries removal with a linear
 * back-off; if the path is *still* locked afterwards we warn instead of
 * throwing, because cleaning up a temp directory must never fail an otherwise
 * passing test. This keeps teardown deterministic across platforms.
 */
export function safeRmSync(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            return;
        }
        if (code && RETRIABLE_RM_CODES.has(code)) {
            console.warn(`safeRmSync: leaving locked temp path behind: ${dir} (${code})`);
            return;
        }
        throw error;
    }
}

/**
 * Create a test git repository with initial commit
 */
export function createTestGitRepo(prefix: string = 'test-git-repo'): GitTestRepo {
    const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    
    try {
        // Initialize git repo
        execSync('git init', { cwd: repoPath, stdio: 'pipe' });
        execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: 'pipe' });
        execSync('git config user.name "Test User"', { cwd: repoPath, stdio: 'pipe' });
        
        // Create initial file and commit
        const initialFile = path.join(repoPath, 'README.md');
        fs.writeFileSync(initialFile, '# Test Repository\n\nInitial content\n');
        execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
        execSync('git commit -m "Initial commit"', { cwd: repoPath, stdio: 'pipe' });
        
        const initialHash = execSync('git rev-parse HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
        
        return {
            repoPath,
            commits: [{
                hash: initialHash,
                message: 'Initial commit',
                files: ['README.md']
            }]
        };
    } catch (error) {
        // Cleanup on error (best-effort, Windows-safe)
        safeRmSync(repoPath);
        throw error;
    }
}

/**
 * Add a commit to the test repository
 */
export function addCommit(
    repo: GitTestRepo,
    message: string,
    files: { path: string; content: string }[]
): GitCommit {
    // Create/modify files
    for (const file of files) {
        const filePath = path.join(repo.repoPath, file.path);
        const dir = path.dirname(filePath);
        
        // Ensure directory exists
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, file.content);
    }
    
    // Stage and commit
    execSync('git add .', { cwd: repo.repoPath, stdio: 'pipe' });
    execSync(`git commit -m "${message}"`, { cwd: repo.repoPath, stdio: 'pipe' });
    
    const hash = execSync('git rev-parse HEAD', { cwd: repo.repoPath, encoding: 'utf8' }).trim();
    
    const commit: GitCommit = {
        hash,
        message,
        files: files.map(f => f.path)
    };
    
    repo.commits.push(commit);
    return commit;
}

/**
 * Get the diff between a commit and its parent
 */
export function getCommitDiff(repo: GitTestRepo, commitHash: string): string {
    return execSync(`git show ${commitHash}`, {
        cwd: repo.repoPath,
        encoding: 'utf8'
    });
}

/**
 * Get the parent hash of a commit
 */
export function getParentHash(repo: GitTestRepo, commitHash: string): string {
    try {
        return execSync(`git rev-parse ${commitHash}^`, {
            cwd: repo.repoPath,
            encoding: 'utf8'
        }).trim();
    } catch (error) {
        // No parent (initial commit)
        return '';
    }
}

/**
 * Get file content at a specific commit
 */
export function getFileAtCommit(
    repo: GitTestRepo,
    commitHash: string,
    filePath: string
): string {
    return execSync(`git show ${commitHash}:${filePath}`, {
        cwd: repo.repoPath,
        encoding: 'utf8'
    });
}

/**
 * Cleanup test repository
 */
export function cleanupTestRepo(repo: GitTestRepo): void {
    safeRmSync(repo.repoPath);
}

/**
 * Create a repository with multiple commits for testing
 */
export function createRepoWithHistory(): GitTestRepo {
    const repo = createTestGitRepo('test-repo-history');
    
    // Commit 2: Add a new file
    addCommit(repo, 'Add feature file', [
        { path: 'src/feature.ts', content: 'export function feature() {\n  return "v1";\n}\n' }
    ]);
    
    // Commit 3: Modify the feature
    addCommit(repo, 'Update feature', [
        { path: 'src/feature.ts', content: 'export function feature() {\n  return "v2";\n}\n' }
    ]);
    
    // Commit 4: Add another file
    addCommit(repo, 'Add utils', [
        { path: 'src/utils.ts', content: 'export function helper() {\n  return true;\n}\n' }
    ]);
    
    return repo;
}
