/**
 * Functional walk-through of the native repository-file backend behind the
 * real server: two registered Git repos, a repo group over both, and the
 * workspace lifecycle routes that must retire a repo's native handle.
 *
 * Every request goes through createExecutionServer, so the registry wiring
 * (trackWorkspaces), the REST contracts and the Rust backend are exercised
 * together rather than through injected stubs.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { createRepoGroup } from '../../src/server/workspaces/repo-group-workspace';
import { safeRmSync } from '../helpers/safe-rm';

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        loadDefaultMcpConfig: vi.fn().mockReturnValue({ mcpServers: {} }),
        sdkServiceRegistry: {
            getOrThrow: () => ({ sendMessage: vi.fn(), isAvailable: vi.fn().mockResolvedValue({ available: false }) }),
        },
    };
});

function request(url: string, method = 'GET', data?: unknown): Promise<{ status: number; json: any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method, headers: { 'Content-Type': 'application/json' } },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    let json: any;
                    try { json = JSON.parse(body); } catch { json = body; }
                    resolve({ status: res.statusCode || 0, json });
                });
            },
        );
        req.on('error', reject);
        if (data !== undefined) req.write(JSON.stringify(data));
        req.end();
    });
}

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

/** A committed repo with an ignored-but-tracked file and an untracked file. */
function makeRepo(root: string, marker: string): void {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    git(root, 'init', '-q');
    fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n');
    fs.writeFileSync(path.join(root, 'src', 'main.ts'), `export const ${marker} = 1;\n// alpha beta\n// gamma\n`);
    fs.writeFileSync(path.join(root, 'README.md'), `# ${marker}\r\nshared-token here\r\n`);
    fs.mkdirSync(path.join(root, 'build'));
    fs.writeFileSync(path.join(root, 'build', 'out.js'), `ignoredTracked_${marker}\n`);
    git(root, 'add', '.gitignore', 'src', 'README.md');
    git(root, 'add', '-f', 'build/out.js');
    git(root, 'commit', '-q', '-m', 'init');
    fs.writeFileSync(path.join(root, 'notes.txt'), `untracked_${marker} shared-token\n`);
}

describe('repository files — functional multi-repo walk-through', () => {
    let server: ExecutionServer;
    let tmp: string;
    let dataDir: string;
    let repoA: string;
    let repoB: string;
    let groupId: string;
    const A = 'ws-functional-a';
    const B = 'ws-functional-b';
    const api = (p: string) => `${server.url}${p}`;
    const repo = (id: string, p: string) => api(`/api/repos/${id}${p}`);
    const q = (s: string) => encodeURIComponent(s);

    async function search(id: string, query: string, extra = ''): Promise<string[]> {
        const res = await request(repo(id, `/search?q=${q(query)}${extra}`));
        expect(res.status).toBe(200);
        return res.json.results.map((r: { path: string }) => r.path);
    }

    async function contentPaths(id: string, query: string, extra = ''): Promise<string[]> {
        const res = await request(repo(id, `/search/content?q=${q(query)}${extra}`));
        expect(res.status).toBe(200);
        return [...new Set<string>(res.json.matches.map((m: { path: string }) => m.path))];
    }

    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-files-functional-'));
        dataDir = path.join(tmp, 'data');
        repoA = path.join(tmp, 'alpha');
        repoB = path.join(tmp, 'bravo');
        fs.mkdirSync(dataDir);
        makeRepo(repoA, 'alphaMarker');
        makeRepo(repoB, 'bravoMarker');
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        expect((await request(api('/api/workspaces'), 'POST', { id: A, name: 'Alpha', rootPath: repoA })).status).toBeLessThan(300);
        expect((await request(api('/api/workspaces'), 'POST', { id: B, name: 'Bravo', rootPath: repoB })).status).toBeLessThan(300);
        groupId = (await createRepoGroup(dataDir, store, { name: 'Functional Group', members: [A, B] })).id;
    });

    afterAll(async () => {
        await server?.close();
        safeRmSync(tmp);
    });

    it('lists trees, files and blobs per repo with ignore handling', async () => {
        for (const [id, marker] of [[A, 'alphaMarker'], [B, 'bravoMarker']] as const) {
            const tree = await request(repo(id, '/tree?path=/&depth=2'));
            expect(tree.status).toBe(200);
            const names = tree.json.entries.map((e: { name: string }) => e.name);
            // Dirs first; flat listings keep .git, the ignored build/ stays hidden.
            expect(names).toEqual(['.git', 'src', '.gitignore', 'notes.txt', 'README.md']);
            expect(tree.json.entries[1].children.map((e: { path: string }) => e.path)).toEqual(['src/main.ts']);
            const shown = await request(repo(id, '/tree?path=.&showIgnored=true'));
            expect(shown.json.entries.map((e: { name: string }) => e.name)).toContain('build');

            const files = await request(repo(id, '/files?path=.'));
            expect(files.json.files.sort()).toEqual(['.gitignore', 'README.md', 'notes.txt', 'src/main.ts']);
            const all = await request(repo(id, '/files?path=.&showIgnored=true'));
            expect(all.json.files).toContain('build/out.js');
            expect(all.json.files.some((f: string) => f.startsWith('.git/'))).toBe(false);

            const blob = await request(repo(id, '/blob?path=README.md'));
            expect(blob.json).toEqual({ content: `# ${marker}\r\nshared-token here\r\n`, encoding: 'utf-8', mimeType: 'text/markdown' });
            expect((await request(repo(id, '/blob?path=../outside'))).status).toBe(400);
        }
    });

    it('searches tracked, ignored-tracked, untracked, regex and multiline content', async () => {
        expect(await contentPaths(A, 'alphaMarker')).toEqual(['README.md', 'notes.txt', 'src/main.ts']);
        expect(await contentPaths(A, 'alphaMarker', '&fileScope=tracked')).toEqual(['README.md', 'build/out.js', 'src/main.ts']);
        expect(await contentPaths(A, 'bravoMarker')).toEqual([]);
        // Ignored-but-tracked content is only reachable through the tracked scope.
        expect(await contentPaths(A, 'ignoredTracked_alphaMarker')).toEqual([]);
        expect(await contentPaths(A, 'ignoredTracked_alphaMarker', '&fileScope=tracked')).toEqual(['build/out.js']);
        expect(await contentPaths(A, 'untracked_alphaMarker', '&fileScope=tracked')).toEqual([]);
        expect(await contentPaths(A, 'untracked_alphaMarker', '&fileScope=tracked&includeUntracked=true')).toEqual(['notes.txt']);
        expect(await contentPaths(A, 'alpha\\w+ = \\d', '&regex=true')).toEqual(['src/main.ts']);

        const multi = await request(repo(A, `/search/content?q=${q('beta\\n// gamma')}&regex=true`));
        expect(multi.json.matches.map((m: any) => [m.line, m.text, m.group])).toEqual([
            [2, '// alpha beta', 0],
            [3, '// gamma', 0],
        ]);
        expect((await request(repo(A, `/search/content?q=${q('(')}&regex=true`))).status).toBe(400);
    });

    it('replaces supplied spans and reports stale files untouched', async () => {
        const res = await request(repo(B, `/search/content?q=shared-token`));
        const hits = res.json.matches as Array<{ path: string; line: number; text: string; startColumn: number; endColumn: number }>;
        expect(hits.map(h => h.path)).toEqual(['README.md', 'notes.txt']);
        // notes.txt changes after the search, so its target no longer matches.
        fs.writeFileSync(path.join(repoB, 'notes.txt'), 'edited elsewhere shared-token\n');
        const files = hits.map(h => ({ path: h.path, targets: [{ line: h.line, text: h.text, startColumn: h.startColumn, endColumn: h.endColumn }] }));
        const replaced = await request(repo(B, '/search/replace'), 'POST', { query: 'shared-token', replacement: 'SHARED', files });
        expect(replaced.status).toBe(200);
        expect(replaced.json.replacedFiles).toBe(1);
        expect(replaced.json.replacedMatches).toBe(1);
        expect(replaced.json.skipped.map((s: any) => [s.path, s.reason])).toEqual([['notes.txt', 'stale']]);
        // CRLF endings survive; the stale file is byte-for-byte untouched.
        expect(fs.readFileSync(path.join(repoB, 'README.md'), 'utf-8')).toBe('# bravoMarker\r\nSHARED here\r\n');
        expect(fs.readFileSync(path.join(repoB, 'notes.txt'), 'utf-8')).toBe('edited elsewhere shared-token\n');
        // Repo A's identical text was never touched.
        expect(fs.readFileSync(path.join(repoA, 'README.md'), 'utf-8')).toContain('shared-token');
    });

    it('makes a written file searchable in its own repo only', async () => {
        // Warm both variants of both repos.
        for (const id of [A, B]) {
            await search(id, 'main');
            await search(id, 'main', '&showIgnored=true');
        }
        const put = await request(repo(A, '/blob?path=src/freshlyWritten.ts'), 'PUT', { content: 'export {};\n' });
        expect(put.json).toEqual({ success: true });
        expect(await search(A, 'freshlyWritten')).toEqual(['src/freshlyWritten.ts']);
        expect(await search(A, 'freshlyWritten', '&showIgnored=true')).toEqual(['src/freshlyWritten.ts']);
        expect(await search(B, 'freshlyWritten')).toEqual([]);
        expect(await search(B, 'freshlyWritten', '&showIgnored=true')).toEqual([]);
    });

    it('routes group searches to live members and reports partial results', async () => {
        const files = await request(api(`/api/repo-groups/${groupId}/search?q=main`));
        expect(files.status).toBe(200);
        expect(files.json.status).toBe('complete');
        expect(files.json.results.map((r: any) => [r.workspaceId, r.path])).toEqual(
            expect.arrayContaining([[A, 'src/main.ts'], [B, 'src/main.ts']]),
        );

        const content = await request(api(`/api/repo-groups/${groupId}/search/content?q=Marker`));
        expect(content.json.status).toBe('complete');
        expect(content.json.members.map((m: any) => [m.workspaceId, m.repoName])).toEqual([[A, 'Alpha'], [B, 'Bravo']]);
        expect(content.json.members[1].matches.every((m: any) => !m.text.includes('alphaMarker'))).toBe(true);

        // Renaming B's root away makes it a stale member: A still answers.
        const moved = `${repoB}-moved`;
        fs.renameSync(repoB, moved);
        try {
            const partial = await request(api(`/api/repo-groups/${groupId}/search/content?q=Marker`));
            expect(partial.json.status).toBe('partial');
            expect(partial.json.members.map((m: any) => m.workspaceId)).toEqual([A]);
            expect(partial.json.failures.map((f: any) => [f.workspaceId, f.reason])).toEqual([[B, 'stale']]);
            expect(JSON.stringify(partial.json)).not.toContain(tmp);
            const partialFiles = await request(api(`/api/repo-groups/${groupId}/search?q=main`));
            expect(partialFiles.json.status).toBe('partial');
            expect(partialFiles.json.results.every((r: any) => r.workspaceId === A)).toBe(true);
        } finally {
            fs.renameSync(moved, repoB);
        }
    });

    it('never serves an old root after a root change, and rejects an unregistered repo', async () => {
        expect(await search(B, 'main')).toEqual(['src/main.ts']);
        const newRoot = path.join(tmp, 'charlie');
        fs.mkdirSync(newRoot);
        fs.writeFileSync(path.join(newRoot, 'only-in-charlie.txt'), 'charlie\n');
        const patched = await request(api(`/api/workspaces/${B}`), 'PATCH', { rootPath: newRoot });
        expect(patched.status).toBe(200);
        expect(await search(B, 'main')).toEqual([]);
        expect(await search(B, 'only-in-charlie')).toEqual(['only-in-charlie.txt']);
        expect(await contentPaths(B, 'bravoMarker')).toEqual([]);

        expect(await search(A, 'main')).toEqual(['src/main.ts']);
        expect((await request(api(`/api/workspaces/${A}`), 'DELETE')).status).toBeLessThan(300);
        for (const p of ['/search?q=main', '/files?path=.', '/tree?path=.', '/blob?path=README.md', '/search/content?q=alphaMarker']) {
            const res = await request(repo(A, p));
            expect(res.status, p).toBe(404);
            expect(res.json.error, p).toBe(`Unknown repo: ${A}`);
        }
    });
});
