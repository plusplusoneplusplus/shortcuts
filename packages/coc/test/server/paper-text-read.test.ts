/**
 * Whole-paper grounding text reader tests (Goal 3, AC-04 server half).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    paperTextSidecarRelPath,
    readPaperText,
    DEFAULT_PAPER_TEXT_BUDGET,
} from '../../src/server/notes/paper-text-read';
import { PAPERS_DIR } from '../../src/server/notes/paper-ingest-handler';

const WS_ID = 'ws-1';

function fakeStore(rootPath: string): any {
    return { getWorkspaces: async () => [{ id: WS_ID, name: 'Test', rootPath }] };
}

/** Build a default-root notes tree and seed a paper text sidecar. */
function seed(text: string | null): { dataDir: string; papersDir: string; cleanup: () => void } {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-paper-text-'));
    const papersDir = path.join(dataDir, 'repos', WS_ID, 'notes', PAPERS_DIR);
    fs.mkdirSync(papersDir, { recursive: true });
    if (text !== null) {
        fs.writeFileSync(path.join(papersDir, '1802.05799.txt'), text, 'utf-8');
    }
    return { dataDir, papersDir, cleanup: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

describe('paperTextSidecarRelPath', () => {
    it('maps a cached .pdf embed path to its .txt sidecar', () => {
        expect(paperTextSidecarRelPath(`${PAPERS_DIR}/1802.05799.pdf`)).toBe(`${PAPERS_DIR}/1802.05799.txt`);
    });
    it('accepts a .txt path directly', () => {
        expect(paperTextSidecarRelPath(`${PAPERS_DIR}/hep-th_9901001.txt`)).toBe(`${PAPERS_DIR}/hep-th_9901001.txt`);
    });
    it('normalizes backslashes', () => {
        expect(paperTextSidecarRelPath(`${PAPERS_DIR}\\a.pdf`)).toBe(`${PAPERS_DIR}/a.txt`);
    });
    it('rejects paths outside the papers cache', () => {
        expect(paperTextSidecarRelPath('notes/x.pdf')).toBeNull();
        expect(paperTextSidecarRelPath('x.pdf')).toBeNull();
    });
    it('rejects traversal and nested dirs', () => {
        expect(paperTextSidecarRelPath(`${PAPERS_DIR}/../secret.pdf`)).toBeNull();
        expect(paperTextSidecarRelPath(`${PAPERS_DIR}/sub/a.pdf`)).toBeNull();
    });
    it('rejects a non-pdf/txt extension and non-strings', () => {
        expect(paperTextSidecarRelPath(`${PAPERS_DIR}/a.exe`)).toBeNull();
        expect(paperTextSidecarRelPath(`${PAPERS_DIR}/`)).toBeNull();
        expect(paperTextSidecarRelPath(42 as unknown)).toBeNull();
    });
});

describe('readPaperText', () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => { cleanups.splice(0).forEach(fn => fn()); });

    it('reads the cached sidecar text for a default-root paper', async () => {
        const s = seed('Ring-AllReduce is bandwidth-optimal.');
        cleanups.push(s.cleanup);
        const text = await readPaperText({
            dataDir: s.dataDir,
            store: fakeStore('/tmp/ws'),
            workspaceId: WS_ID,
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
        });
        expect(text).toBe('Ring-AllReduce is bandwidth-optimal.');
    });

    it('returns null when the sidecar is missing', async () => {
        const s = seed(null);
        cleanups.push(s.cleanup);
        const text = await readPaperText({
            dataDir: s.dataDir,
            store: fakeStore('/tmp/ws'),
            workspaceId: WS_ID,
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
        });
        expect(text).toBeNull();
    });

    it('returns null for an empty/whitespace sidecar', async () => {
        const s = seed('   \n  ');
        cleanups.push(s.cleanup);
        const text = await readPaperText({
            dataDir: s.dataDir,
            store: fakeStore('/tmp/ws'),
            workspaceId: WS_ID,
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
        });
        expect(text).toBeNull();
    });

    it('returns null for an unknown workspace', async () => {
        const s = seed('text');
        cleanups.push(s.cleanup);
        const text = await readPaperText({
            dataDir: s.dataDir,
            store: fakeStore('/tmp/ws'),
            workspaceId: 'ws-unknown',
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
        });
        expect(text).toBeNull();
    });

    it('returns null for a path outside the papers cache (no read attempted)', async () => {
        const s = seed('text');
        cleanups.push(s.cleanup);
        const text = await readPaperText({
            dataDir: s.dataDir,
            store: fakeStore('/tmp/ws'),
            workspaceId: WS_ID,
            paperPath: '../secret.pdf',
        });
        expect(text).toBeNull();
    });

    it('caps the returned text at the character budget', async () => {
        const s = seed('x'.repeat(DEFAULT_PAPER_TEXT_BUDGET + 500));
        cleanups.push(s.cleanup);
        const text = await readPaperText({
            dataDir: s.dataDir,
            store: fakeStore('/tmp/ws'),
            workspaceId: WS_ID,
            paperPath: `${PAPERS_DIR}/1802.05799.pdf`,
            maxChars: 100,
        });
        expect(text).toHaveLength(100);
    });
});
