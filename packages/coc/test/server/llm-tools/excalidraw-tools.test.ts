import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    createExcalidrawTools,
    normaliseFilename as normaliseExcalidrawFilename,
} from '../../../src/server/llm-tools/excalidraw-tools';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-tools-test-'));
}

function rmrf(dir: string): void {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const SAMPLE_SCENE = {
    type: 'excalidraw',
    version: 2,
    elements: [
        {
            id: 'rect1',
            type: 'rectangle',
            x: 10,
            y: 20,
            width: 100,
            height: 50,
        },
    ],
    appState: {
        viewBackgroundColor: '#ffffff',
    },
};

describe('normaliseExcalidrawFilename', () => {
    it('auto-appends .excalidraw extension', () => {
        expect(normaliseExcalidrawFilename('architecture')).toBe('architecture.excalidraw');
    });

    it('preserves existing .excalidraw extension', () => {
        expect(normaliseExcalidrawFilename('architecture.excalidraw')).toBe('architecture.excalidraw');
    });

    it('rejects empty string', () => {
        expect(normaliseExcalidrawFilename('')).toBeNull();
    });

    it('rejects path traversal with ..', () => {
        expect(normaliseExcalidrawFilename('../evil')).toBeNull();
    });

    it('rejects forward slash', () => {
        expect(normaliseExcalidrawFilename('sub/dir')).toBeNull();
    });

    it('rejects backslash', () => {
        expect(normaliseExcalidrawFilename('sub\\dir')).toBeNull();
    });

    it('rejects whitespace-only base name', () => {
        expect(normaliseExcalidrawFilename('   ')).toBeNull();
    });
});

describe('createExcalidrawTools', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = createTempDir();
    });

    afterEach(() => {
        rmrf(tmpDir);
    });

    function makeTools(workspaceId = 'ws-test') {
        return createExcalidrawTools({ dataDir: tmpDir, workspaceId });
    }

    // ====================================================================
    // create_or_update_excalidraw
    // ====================================================================

    describe('create_or_update_excalidraw', () => {
        it('has the expected tool metadata', () => {
            const { createOrUpdate } = makeTools();
            expect(createOrUpdate.name).toBe('create_or_update_excalidraw');
            expect(createOrUpdate.description).toBeDefined();
            expect(createOrUpdate.parameters).toBeDefined();
            expect(typeof createOrUpdate.handler).toBe('function');
        });

        it('creates a new diagram file and returns success', async () => {
            const { createOrUpdate } = makeTools();
            const result = await createOrUpdate.handler({
                filename: 'arch',
                content: SAMPLE_SCENE,
            }) as any;

            expect(result.success).toBe(true);
            expect(result.filename).toBe('arch.excalidraw');
            expect(result.created).toBe(true);
            expect(result.sizeBytes).toBeGreaterThan(0);
            expect(result.excalidrawLink).toBe('excalidraw://ws-test/arch.excalidraw');
        });

        it('updates an existing diagram (created = false)', async () => {
            const { createOrUpdate } = makeTools();
            await createOrUpdate.handler({ filename: 'arch', content: SAMPLE_SCENE });
            const result = await createOrUpdate.handler({
                filename: 'arch',
                content: { ...SAMPLE_SCENE, version: 3 },
            }) as any;

            expect(result.success).toBe(true);
            expect(result.created).toBe(false);
        });

        it('writes valid JSON to disk', async () => {
            const { createOrUpdate } = makeTools();
            await createOrUpdate.handler({ filename: 'test', content: SAMPLE_SCENE });

            const diagramsRoot = path.join(tmpDir, 'repos', 'ws-test', 'diagrams');
            const raw = fs.readFileSync(path.join(diagramsRoot, 'test.excalidraw'), 'utf-8');
            const parsed = JSON.parse(raw);
            expect(parsed.type).toBe('excalidraw');
            expect(parsed.elements).toHaveLength(1);
        });

        it('rejects missing filename', async () => {
            const { createOrUpdate } = makeTools();
            const result = await createOrUpdate.handler({
                filename: '',
                content: SAMPLE_SCENE,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('rejects path traversal in filename', async () => {
            const { createOrUpdate } = makeTools();
            const result = await createOrUpdate.handler({
                filename: '../escape',
                content: SAMPLE_SCENE,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid filename');
        });

        it('rejects missing content', async () => {
            const { createOrUpdate } = makeTools();
            const result = await createOrUpdate.handler({
                filename: 'test',
                content: null as any,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('content');
        });

        it('rejects non-object content', async () => {
            const { createOrUpdate } = makeTools();
            const result = await createOrUpdate.handler({
                filename: 'test',
                content: 'not an object' as any,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('content');
        });
    });

    // ====================================================================
    // read_excalidraw
    // ====================================================================

    describe('read_excalidraw', () => {
        it('has the expected tool metadata', () => {
            const { read } = makeTools();
            expect(read.name).toBe('read_excalidraw');
            expect(read.description).toBeDefined();
            expect(read.parameters).toBeDefined();
            expect(typeof read.handler).toBe('function');
        });

        it('reads an existing diagram', async () => {
            const { createOrUpdate, read } = makeTools();
            await createOrUpdate.handler({ filename: 'test', content: SAMPLE_SCENE });

            const result = await read.handler({ filename: 'test' }) as any;
            expect(result.success).toBe(true);
            expect(result.filename).toBe('test.excalidraw');
            expect(result.content.type).toBe('excalidraw');
            expect(result.content.elements).toHaveLength(1);
            expect(result.sizeBytes).toBeGreaterThan(0);
        });

        it('returns error for non-existent diagram', async () => {
            const { read } = makeTools();
            const result = await read.handler({ filename: 'missing' }) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('rejects missing filename', async () => {
            const { read } = makeTools();
            const result = await read.handler({ filename: '' }) as any;
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('rejects path traversal', async () => {
            const { read } = makeTools();
            const result = await read.handler({ filename: '../etc/passwd' }) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid filename');
        });
    });

    // ====================================================================
    // Workspace isolation
    // ====================================================================

    describe('workspace isolation', () => {
        it('different workspaces have separate diagrams', async () => {
            const tools1 = createExcalidrawTools({ dataDir: tmpDir, workspaceId: 'ws-a' });
            const tools2 = createExcalidrawTools({ dataDir: tmpDir, workspaceId: 'ws-b' });

            await tools1.createOrUpdate.handler({ filename: 'shared-name', content: SAMPLE_SCENE });

            const r1 = await tools1.read.handler({ filename: 'shared-name' }) as any;
            const r2 = await tools2.read.handler({ filename: 'shared-name' }) as any;

            expect(r1.success).toBe(true);
            expect(r2.success).toBe(false);
            expect(r2.error).toContain('not found');
        });
    });
});
