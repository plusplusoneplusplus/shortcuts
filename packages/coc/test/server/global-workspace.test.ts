/**
 * Global Workspace Tests
 *
 * Verifies that:
 * - ensureGlobalWorkspace creates the directory
 * - Calling it twice does not create duplicate workspace entries
 * - Returned workspace has correct id, name, virtual: true
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureGlobalWorkspace, GLOBAL_WORKSPACE_ID, GLOBAL_WORKSPACE_NAME } from '../../src/server/global-workspace';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';

describe('ensureGlobalWorkspace', () => {
    let dataDir: string;
    let store: FileProcessStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-ws-test-'));
        store = new FileProcessStore({ dataDir });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('creates the global-workspace directory', async () => {
        await ensureGlobalWorkspace(dataDir, store);
        const dir = path.join(dataDir, 'global-workspace');
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('returns workspace with correct id, name, and virtual flag', async () => {
        const ws = await ensureGlobalWorkspace(dataDir, store);
        expect(ws.id).toBe(GLOBAL_WORKSPACE_ID);
        expect(ws.name).toBe(GLOBAL_WORKSPACE_NAME);
        expect(ws.virtual).toBe(true);
        expect(ws.rootPath).toBe(path.join(dataDir, 'global-workspace'));
    });

    it('is idempotent — calling twice does not create duplicate entries', async () => {
        await ensureGlobalWorkspace(dataDir, store);
        await ensureGlobalWorkspace(dataDir, store);
        const workspaces = await store.getWorkspaces();
        const globals = workspaces.filter(w => w.id === GLOBAL_WORKSPACE_ID);
        expect(globals).toHaveLength(1);
    });

    it('registers workspace in the store', async () => {
        await ensureGlobalWorkspace(dataDir, store);
        const workspaces = await store.getWorkspaces();
        const global = workspaces.find(w => w.id === GLOBAL_WORKSPACE_ID);
        expect(global).toBeDefined();
        expect(global!.virtual).toBe(true);
        expect(global!.name).toBe(GLOBAL_WORKSPACE_NAME);
    });
});
