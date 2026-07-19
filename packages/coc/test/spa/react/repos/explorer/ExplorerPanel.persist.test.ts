/**
 * Source-level assertions for ExplorerPanel's per-workspace state persistence
 * (AC-01 of preserve-explorer-state): the panel's expanded paths + selected /
 * open preview file are backed by the localStorage-backed explorerStateStore so
 * they survive the `key={ws.id}` remount on a workspace switch, and a stale hash
 * from another workspace does not clobber the restored state.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PANEL_PATH = path.join(
    __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'explorer', 'ExplorerPanel.tsx',
);

describe('ExplorerPanel — persisted per-workspace state (source)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(PANEL_PATH, 'utf-8');
    });

    it('imports the per-workspace explorer state hooks', () => {
        expect(source).toContain(
            "import { useExplorerExpandedPaths, useExplorerSelectedPath, useExplorerPreviewFile } from './explorerStateStore'",
        );
    });

    it('backs selectedPath with the persisted store hook', () => {
        expect(source).toContain('const [selectedPath, setSelectedPath] = useExplorerSelectedPath(workspaceId)');
    });

    it('backs expandedPaths with the persisted store hook', () => {
        expect(source).toContain('const [expandedPaths, setExpandedPaths] = useExplorerExpandedPaths(workspaceId)');
    });

    it('backs previewFile with the persisted store hook', () => {
        expect(source).toContain('const [previewFile, setPreviewFile] = useExplorerPreviewFile(workspaceId)');
    });

    it('no longer uses plain useState for the persisted fields', () => {
        expect(source).not.toContain('useState<Set<string>>(new Set())');
        expect(source).not.toContain("useState<{ path: string; name: string } | null>(null)");
    });

    it('guards the hash deep-link against a foreign workspace id', () => {
        // A hash left over from another workspace must not override this
        // workspace's restored state — each workspace stays independent.
        expect(source).toContain("decodeURIComponent(parts[1] ?? '') === workspaceId");
    });

    it('keys the deep-link effect on workspaceId', () => {
        expect(source).toContain('}, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps');
    });
});
