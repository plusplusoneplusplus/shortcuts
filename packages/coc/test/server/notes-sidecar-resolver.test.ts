/**
 * Sidecar placement + access control tests.
 *
 * Covers where a note's `.comments.json` / `.paper-annotations.json` file lands
 * and which note paths a workspace may annotate at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encodeRootPath, DEFAULT_ROOT_ID } from '../../src/server/notes/notes-root-resolver';
import type { ResolvedNotesRoot } from '../../src/server/notes/notes-root-resolver';
import { resolveNoteSidecarPath } from '../../src/server/notes/notes-sidecar-resolver';

const COMMENTS = '.comments.json';
const ANNOTATIONS = '.paper-annotations.json';

describe('resolveNoteSidecarPath', () => {
    let dataDir: string;
    let workspaceDir: string;
    const workspaceId = 'ws-123';

    let wsDataDir: string;
    let defaultRoot: ResolvedNotesRoot;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-ws-'));
        wsDataDir = path.join(dataDir, 'repos', workspaceId);
        defaultRoot = {
            absolutePath: path.join(wsDataDir, 'notes'),
            isDefault: true,
            rootId: DEFAULT_ROOT_ID,
        };
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    function resolve(notePath: string, root: ResolvedNotesRoot = defaultRoot, suffix = COMMENTS) {
        return resolveNoteSidecarPath({
            dataDir,
            workspace: { id: workspaceId, rootPath: workspaceDir },
            root,
            notePath,
            suffix,
        });
    }

    function managedPath(bucket: string, relative: string, suffix = COMMENTS): string {
        return path.join(wsDataDir, 'notes-comments', encodeRootPath(bucket), relative + suffix);
    }

    // ── Co-located placement (managed areas) ────────────────────────────────

    it('co-locates the sidecar for a relative note under the default root', async () => {
        const result = await resolve('page.md');
        expect(result).toBe(path.join(defaultRoot.absolutePath, 'page.md' + COMMENTS));
    });

    it('co-locates the sidecar for an absolute note inside the workspace data dir', async () => {
        const absNotePath = path.join(wsDataDir, 'tasks', 'my-task.plan.md');
        const result = await resolve(absNotePath);
        expect(result).toBe(absNotePath + COMMENTS);
    });

    it('co-locates the sidecar for an absolute note inside ~/.copilot', async () => {
        const absNotePath = path.join(os.homedir(), '.copilot', 'history', 'session.md');
        const result = await resolve(absNotePath);
        expect(result).toBe(absNotePath + COMMENTS);
    });

    // ── Workspace repo files (chat scratchpad) ──────────────────────────────

    it('stores sidecars for workspace repo files in the managed area, not in the repo', async () => {
        const absNotePath = path.join(workspaceDir, 'docs', 'design.md');
        const result = await resolve(absNotePath);

        expect(result).toBe(managedPath('.', path.join('docs', 'design.md')));
        expect(result).not.toContain(workspaceDir + path.sep + 'docs');
    });

    it('uses the same managed placement for paper annotations', async () => {
        const absNotePath = path.join(workspaceDir, 'paper.md');
        const result = await resolve(absNotePath, defaultRoot, ANNOTATIONS);
        expect(result).toBe(managedPath('.', 'paper.md', ANNOTATIONS));
    });

    it('keeps the workspace-root bucket distinct from repo-folder root buckets', async () => {
        const repoRoot: ResolvedNotesRoot = {
            absolutePath: path.join(workspaceDir, 'docs'),
            isDefault: false,
            rootId: 'docs',
        };
        const viaDefault = await resolve(path.join(workspaceDir, 'docs', 'page.md'));
        const viaRepoRoot = await resolve('page.md', repoRoot);
        expect(viaDefault).not.toBe(viaRepoRoot);
    });

    // ── Repo-folder roots ───────────────────────────────────────────────────

    it('stores repo-folder root sidecars under the encoded root bucket', async () => {
        const repoRoot: ResolvedNotesRoot = {
            absolutePath: path.join(workspaceDir, 'docs', 'notes'),
            isDefault: false,
            rootId: 'docs/notes',
        };
        const result = await resolve('sub/page.md', repoRoot);
        expect(result).toBe(managedPath('docs/notes', path.join('sub', 'page.md')));
    });

    it('rejects parent traversal within a repo-folder root', async () => {
        const repoRoot: ResolvedNotesRoot = {
            absolutePath: path.join(workspaceDir, 'docs', 'notes'),
            isDefault: false,
            rootId: 'docs/notes',
        };
        const result = await resolve('../../secret.md', repoRoot);
        expect(typeof result).toBe('object');
        expect((result as { statusCode: number }).statusCode).toBe(403);
    });

    // ── Access control ──────────────────────────────────────────────────────

    it('denies absolute notes outside the data dir, ~/.copilot and the workspace root', async () => {
        const outside = path.join(os.tmpdir(), 'evil-notes', 'secret.md');
        const result = await resolve(outside);
        expect(typeof result).toBe('object');
        expect((result as { statusCode: number }).statusCode).toBe(403);
    });

    it('denies workspace repo paths when the workspace has no root path', async () => {
        const result = await resolveNoteSidecarPath({
            dataDir,
            workspace: { id: workspaceId },
            root: defaultRoot,
            notePath: path.join(workspaceDir, 'docs', 'design.md'),
            suffix: COMMENTS,
        });
        expect(typeof result).toBe('object');
        expect((result as { statusCode: number }).statusCode).toBe(403);
    });
});
