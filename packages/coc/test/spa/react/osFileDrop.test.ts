import { afterEach, describe, expect, it } from 'vitest';
import {
    dataTransferHasOsFileDrag,
    readOsFileDropPaths,
    toWorkspaceDropPath,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';

const REPO_ROOT = '/home/dev/repo';

/** Stand-in for the desktop preload bridge; `paths` maps File -> absolute path. */
function installDesktopBridge(paths: Map<object, string | null>, options: { throws?: boolean } = {}) {
    (globalThis as any).window = {
        cocDesktop: {
            isDesktop: true,
            getPathForFile: (file: object) => {
                if (options.throws) throw new Error('no path');
                return paths.get(file) ?? null;
            },
        },
    };
}

function makeTransfer(files: object[]) {
    return { types: ['Files'], files: files as unknown as ArrayLike<File> };
}

afterEach(() => {
    delete (globalThis as any).window;
});

describe('OS file drop path resolution', () => {
    it('shortens a file inside the workspace to a repo-relative path', () => {
        const file = {};
        installDesktopBridge(new Map([[file, `${REPO_ROOT}/src/index.ts`]]));
        expect(readOsFileDropPaths(makeTransfer([file]), REPO_ROOT)).toEqual(['src/index.ts']);
    });

    it('keeps a file outside the workspace as its absolute path', () => {
        const file = {};
        installDesktopBridge(new Map([[file, '/home/dev/Downloads/x.pdf']]));
        expect(readOsFileDropPaths(makeTransfer([file]), REPO_ROOT)).toEqual(['/home/dev/Downloads/x.pdf']);
    });

    it('keeps the absolute path when the workspace root is unknown', () => {
        const file = {};
        installDesktopBridge(new Map([[file, `${REPO_ROOT}/src/index.ts`]]));
        expect(readOsFileDropPaths(makeTransfer([file]), undefined)).toEqual([`${REPO_ROOT}/src/index.ts`]);
        expect(readOsFileDropPaths(makeTransfer([file]), '  ')).toEqual([`${REPO_ROOT}/src/index.ts`]);
    });

    it('resolves every file of a multi-file drop, in drop order', () => {
        const a = {}, b = {}, c = {};
        installDesktopBridge(new Map<object, string>([
            [a, `${REPO_ROOT}/a.ts`],
            [b, '/tmp/b.txt'],
            [c, `${REPO_ROOT}/docs/c.md`],
        ]));
        expect(readOsFileDropPaths(makeTransfer([a, b, c]), REPO_ROOT))
            .toEqual(['a.ts', '/tmp/b.txt', 'docs/c.md']);
    });

    it('skips files the bridge cannot resolve instead of failing the whole drop', () => {
        const a = {}, b = {};
        installDesktopBridge(new Map<object, string | null>([[a, null], [b, '/tmp/b.txt']]));
        expect(readOsFileDropPaths(makeTransfer([a, b]), REPO_ROOT)).toEqual(['/tmp/b.txt']);
    });

    it('resolves nothing when the bridge throws', () => {
        const file = {};
        installDesktopBridge(new Map([[file, '/tmp/x']]), { throws: true });
        expect(readOsFileDropPaths(makeTransfer([file]), REPO_ROOT)).toEqual([]);
    });

    it('normalizes Windows separators on both the path and the root', () => {
        expect(toWorkspaceDropPath('C:\\repo\\src\\index.ts', 'C:\\repo')).toBe('src/index.ts');
        expect(toWorkspaceDropPath('C:\\other\\x.pdf', 'C:\\repo')).toBe('C:/other/x.pdf');
    });
});

describe('OS file drag detection', () => {
    it('accepts a "Files" drag inside the desktop shell', () => {
        installDesktopBridge(new Map());
        expect(dataTransferHasOsFileDrag({ types: ['Files'] })).toBe(true);
        expect(dataTransferHasOsFileDrag({ types: ['text/plain'] })).toBe(false);
        expect(dataTransferHasOsFileDrag(null)).toBe(false);
    });

    it('inserts nothing in the browser SPA, where there is no path bridge', () => {
        (globalThis as any).window = {};
        expect(dataTransferHasOsFileDrag({ types: ['Files'] })).toBe(false);
        expect(readOsFileDropPaths(makeTransfer([{}]), REPO_ROOT)).toEqual([]);
    });

    it('inserts nothing when cocDesktop exists but lacks the bridge function', () => {
        (globalThis as any).window = { cocDesktop: { isDesktop: true } };
        expect(dataTransferHasOsFileDrag({ types: ['Files'] })).toBe(false);
        expect(readOsFileDropPaths(makeTransfer([{}]), REPO_ROOT)).toEqual([]);
    });
});
