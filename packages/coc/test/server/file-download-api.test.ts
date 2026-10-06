import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { FileProcessStore, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { registerTaskRoutes } from '../../src/server/tasks/tasks-read-handler';
import { createRouter } from '../../src/server/shared/router';
import { createRepoGroup } from '../../src/server/workspaces/repo-group-workspace';
import type { Route } from '../../src/server/types';

describe('File download API', () => {
    let fixtureDir: string;
    let dataDir: string;
    let store: FileProcessStore;
    let workspace: WorkspaceInfo;
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
        fixtureDir = path.resolve(`.file-download-test-${randomUUID()}`);
        dataDir = path.join(fixtureDir, 'data');
        workspace = { id: 'download-repo', name: 'Download repo', rootPath: path.join(fixtureDir, 'repo') };
        fs.mkdirSync(workspace.rootPath, { recursive: true });
        fs.mkdirSync(dataDir, { recursive: true });
        store = new FileProcessStore({ dataDir });
        await store.registerWorkspace(workspace);
        const routes: Route[] = [];
        registerTaskRoutes(routes, store, dataDir);
        server = http.createServer(createRouter({ routes, spaHtml: '' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        vi.restoreAllMocks();
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });

    async function request(filePath?: string, workspaceId = workspace.id, download = 'true', resolve = false) {
        const query = new URLSearchParams({ download });
        if (resolve) query.set('resolve', 'true');
        if (filePath !== undefined) query.set('path', filePath);
        const response = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/files/preview?${query}`);
        return {
            status: response.status,
            headers: response.headers,
            body: Buffer.from(await response.arrayBuffer()),
        };
    }

    function writeFile(filePath: string, content: Buffer | string): string {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        return filePath;
    }

    it.each([
        ['readme.txt', Buffer.from('first line\r\nsecond line\nUTF-8: café')],
        ['picture.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a])],
        ['document.pdf', Buffer.from('%PDF-1.7\n\x00\xff\n%%EOF', 'latin1')],
        ['archive.zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80])],
    ])('downloads %s as unmodified raw bytes', async (fileName, content) => {
        writeFile(path.join(workspace.rootPath, fileName), content);
        const response = await request(fileName);
        expect(response.status).toBe(200);
        expect(response.body).toEqual(content);
        expect(response.headers.get('content-type')).toBe('application/octet-stream');
        expect(response.headers.get('content-length')).toBe(String(content.length));
        expect(response.headers.get('content-disposition')).toBe(
            `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
        );
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('streams files exceeding preview limits without readFile buffering', async () => {
        const content = Buffer.alloc(5 * 1024 * 1024, 0xab);
        const filePath = writeFile(path.join(workspace.rootPath, 'large.bin'), content);
        const readFile = vi.spyOn(fs.promises, 'readFile');
        const response = await request(filePath);
        expect(response.status).toBe(200);
        expect(response.body).toEqual(content);
        expect(readFile.mock.calls.some(args => String(args[0]) === filePath)).toBe(false);
    });

    it('retains preview behavior unless download=true', async () => {
        writeFile(path.join(workspace.rootPath, 'readme.txt'), 'hello\n');
        for (const flag of ['', 'false', '1']) {
            const response = await request('readme.txt', workspace.id, flag);
            expect(response.status).toBe(200);
            expect(JSON.parse(response.body.toString())).toMatchObject({
                type: 'file', resolvedWorkspaceId: workspace.id, lines: ['hello'],
            });
            expect(response.headers.get('content-disposition')).toBeNull();
        }
        writeFile(path.join(workspace.rootPath, 'document.pdf'), '%PDF');
        expect((await request('document.pdf', workspace.id, 'false')).status).toBe(400);
    });

    it.each(['readme.txt', 'picture.png', 'document.pdf', 'archive.zip'])(
        'resolves %s metadata without reading bytes',
        async fileName => {
            const content = Buffer.from([0, 255, 128, 10]);
            const filePath = writeFile(path.join(workspace.rootPath, fileName), content);
            const readFile = vi.spyOn(fs.promises, 'readFile');
            const response = await request(fileName, workspace.id, 'false', true);
            expect(response.status).toBe(200);
            expect(JSON.parse(response.body.toString())).toEqual({
                type: 'file',
                path: filePath,
                resolvedWorkspaceId: workspace.id,
                fileName,
                size: content.length,
            });
            expect(response.headers.get('content-disposition')).toBeNull();
            expect(readFile.mock.calls.some(args => String(args[0]) === filePath)).toBe(false);
        },
    );

    it('resolves directory metadata without listing contents', async () => {
        const directory = path.join(workspace.rootPath, 'directory');
        writeFile(path.join(directory, 'child.txt'), 'content');
        const readdir = vi.spyOn(fs.promises, 'readdir');
        const response = await request('directory', workspace.id, 'false', true);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body.toString())).toEqual({
            type: 'directory',
            path: directory,
            resolvedWorkspaceId: workspace.id,
            fileName: 'directory',
            size: fs.statSync(directory).size,
        });
        expect(readdir).not.toHaveBeenCalled();
    });

    it('returns metadata when both resolve and download are requested', async () => {
        writeFile(path.join(workspace.rootPath, 'document.pdf'), '%PDF');
        const response = await request('document.pdf', workspace.id, 'true', true);
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body.toString())).toMatchObject({ type: 'file', fileName: 'document.pdf', size: 4 });
        expect(response.headers.get('content-disposition')).toBeNull();
    });

    it('downloads repo-scoped tasks and trusted server data files', async () => {
        for (const filePath of [
            path.join(dataDir, 'repos', workspace.id, 'tasks', 'plan.md'),
            path.join(dataDir, 'tool-output.bin'),
        ]) {
            writeFile(filePath, 'trusted content');
            const response = await request(filePath);
            expect(response.status).toBe(200);
            expect(response.body.toString()).toBe('trusted content');
        }
    });

    async function groupFixture() {
        const member = { id: 'second-repo', name: 'Second repo', rootPath: path.join(fixtureDir, 'second-repo') };
        fs.mkdirSync(member.rootPath, { recursive: true });
        await store.registerWorkspace(member);
        const group = await createRepoGroup(dataDir, store, {
            name: 'Download group', members: [workspace.id, member.id], readOnly: { [member.id]: true },
        });
        return { member, group };
    }

    it('resolves group relative paths in member order and absolute paths to their member', async () => {
        const { member, group } = await groupFixture();
        const firstFile = writeFile(path.join(workspace.rootPath, 'shared.txt'), 'first member');
        const secondFile = writeFile(path.join(member.rootPath, 'shared.txt'), 'second member');
        const uniqueFile = writeFile(path.join(member.rootPath, 'only-second.zip'), Buffer.from([0, 255, 128]));
        expect((await request('shared.txt', group.id)).body.toString()).toBe('first member');
        expect((await request(firstFile, group.id)).body.toString()).toBe('first member');
        expect((await request(secondFile, group.id)).body.toString()).toBe('second member');
        expect((await request('only-second.zip', group.id)).body).toEqual(fs.readFileSync(uniqueFile));
        expect((await request('missing.txt', group.id)).status).toBe(404);
        expect((await request('../outside.txt', group.id)).status).toBe(403);
    });

    it('preflights group files and directories with their resolved member owner', async () => {
        const { member, group } = await groupFixture();
        writeFile(path.join(workspace.rootPath, 'shared.pdf'), 'first');
        const secondFile = writeFile(path.join(member.rootPath, 'shared.pdf'), 'second');
        const directory = path.join(member.rootPath, 'only-second');
        writeFile(path.join(directory, 'archive.zip'), 'archive');
        for (const [requestedPath, expectedPath, owner, type] of [
            ['shared.pdf', path.join(workspace.rootPath, 'shared.pdf'), workspace.id, 'file'],
            [secondFile, secondFile, member.id, 'file'],
            ['only-second/archive.zip', path.join(directory, 'archive.zip'), member.id, 'file'],
            ['only-second', directory, member.id, 'directory'],
        ]) {
            const response = await request(requestedPath, group.id, 'false', true);
            expect(response.status).toBe(200);
            expect(JSON.parse(response.body.toString())).toEqual({
                type,
                path: expectedPath,
                resolvedWorkspaceId: owner,
                fileName: path.basename(expectedPath),
                size: fs.statSync(expectedPath).size,
            });
        }
        expect((await request('missing.pdf', group.id, 'false', true)).status).toBe(404);
        expect((await request('../outside.pdf', group.id, 'false', true)).status).toBe(403);
    });

    it('applies download authorization and invalid-path checks to metadata preflight', async () => {
        const { member, group } = await groupFixture();
        const outside = path.join(fixtureDir, 'outside');
        writeFile(path.join(outside, 'secret.pdf'), 'not authorized');
        for (const root of [workspace.rootPath, member.rootPath, dataDir]) {
            fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
        }
        expect((await request(undefined, workspace.id, 'false', true)).status).toBe(400);
        expect((await request('\0', workspace.id, 'false', true)).status).toBe(400);
        expect((await request('missing.pdf', workspace.id, 'false', true)).status).toBe(404);
        expect((await request('escape/secret.pdf', workspace.id, 'false', true)).status).toBe(403);
        expect((await request(path.join(member.rootPath, 'escape'), group.id, 'false', true)).status).toBe(403);
        expect((await request(path.join(dataDir, 'escape', 'secret.pdf'), workspace.id, 'false', true)).status).toBe(403);
        expect((await request(path.join(outside, 'secret.pdf'), workspace.id, 'false', true)).status).toBe(403);
        expect((await request('secret.pdf', 'unknown-workspace', 'false', true)).status).toBe(404);
    });

    it('denies missing paths, directories, traversal, unknown owners and invalid paths', async () => {
        writeFile(path.join(fixtureDir, 'outside.txt'), 'not authorized');
        fs.mkdirSync(path.join(workspace.rootPath, 'directory'));
        writeFile(path.join(workspace.rootPath, 'file.txt'), 'content');
        expect((await request()).status).toBe(400);
        expect((await request('')).status).toBe(400);
        expect((await request('\0')).status).toBe(400);
        expect((await request('missing.txt')).status).toBe(404);
        expect((await request('file.txt/child')).status).toBe(404);
        expect((await request('directory')).status).toBe(400);
        expect((await request('../outside.txt')).status).toBe(403);
        expect((await request(path.join(fixtureDir, 'outside.txt'))).status).toBe(403);
        expect((await request('file.txt', 'unknown-workspace')).status).toBe(404);
    });

    it('rejects symlink escapes from workspace, group member and trusted data roots', async () => {
        const { member, group } = await groupFixture();
        const outside = path.join(fixtureDir, 'outside');
        writeFile(path.join(outside, 'secret.bin'), 'not authorized');
        for (const root of [workspace.rootPath, member.rootPath, dataDir]) {
            fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
        }
        expect((await request('escape/secret.bin')).status).toBe(403);
        expect((await request(path.join(member.rootPath, 'escape', 'secret.bin'), group.id)).status).toBe(403);
        expect((await request(path.join(dataDir, 'escape', 'secret.bin'))).status).toBe(403);
    });

    it('allows symlinks contained within the authorized root', async () => {
        const targetDir = path.join(workspace.rootPath, 'target');
        writeFile(path.join(targetDir, 'content.txt'), 'contained content');
        fs.symlinkSync(targetDir, path.join(workspace.rootPath, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
        const response = await request('alias/content.txt');
        expect(response.status).toBe(200);
        expect(response.body.toString()).toBe('contained content');
    });

    it('encodes UTF-8 and RFC 5987 filename characters safely', async () => {
        const fileName = "résumé (draft)'*.txt".replace('*', process.platform === 'win32' ? '-' : '*');
        writeFile(path.join(workspace.rootPath, fileName), 'content');
        const response = await request(fileName);
        expect(response.status).toBe(200);
        const disposition = response.headers.get('content-disposition')!;
        expect(disposition).toContain('filename="r_sum_ (draft)');
        expect(disposition).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%28draft%29%27");
        expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe(fileName);
        expect(disposition).not.toContain(workspace.rootPath);
    });

    it.skipIf(process.platform === 'win32')('sanitizes quotes, backslashes and control characters in attachment headers', async () => {
        const fileName = 'report"\\\r\ninjected.txt';
        writeFile(path.join(workspace.rootPath, fileName), 'content');
        const response = await request(fileName);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-disposition')).toBe(
            'attachment; filename="report____injected.txt"; filename*=UTF-8\'\'report%22%5C__injected.txt',
        );
        expect(response.headers.get('injected')).toBeNull();
    });
});
