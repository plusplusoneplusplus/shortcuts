/**
 * The oracle must define its own walk order rather than inherit the host's.
 *
 * `fs.readdirSync` is byte-sorted by libuv on Unix but returns NTFS index
 * order on Windows, which is case-insensitive. An oracle that walks in
 * whatever order it is handed therefore disagrees with the native index on
 * Windows alone — the parity suite goes green on Linux and macOS and red on
 * the Windows runner, on result order rather than on search semantics. The
 * mocked readdir below reproduces that Windows order on any host.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ useWindowsDirectoryOrder: false }));

vi.mock('fs', async importOriginal => {
    const actual = await importOriginal<typeof import('fs')>();
    /** Case-insensitive collation, the order NTFS enumerates a directory in. */
    const windowsOrder = (left: fs.Dirent, right: fs.Dirent) => {
        const [a, b] = [left.name.toUpperCase(), right.name.toUpperCase()];
        return a < b ? -1 : a > b ? 1 : 0;
    };
    const readdirSync = ((directory: fs.PathLike, options: never) => {
        const entries = actual.readdirSync(directory, options);
        if (!mocked.useWindowsDirectoryOrder) return entries;
        return [...(entries as unknown as fs.Dirent[])].sort(windowsOrder);
    }) as typeof actual.readdirSync;
    return { ...actual, default: { ...actual, readdirSync }, readdirSync };
});

const { searchNotesOracle } = await import('./notes-index-oracle');

let root = '';

afterEach(() => {
    mocked.useWindowsDirectoryOrder = false;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = '';
});

it('walks in filename byte order whatever order readdir returns', () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-oracle-order-'));
    // Byte order is Needle.md, a-first.md, nested/, z-last.md; the
    // case-insensitive order starts with a-first.md instead.
    fs.writeFileSync(path.join(root, 'Needle.md'), 'order-token');
    fs.writeFileSync(path.join(root, 'a-first.md'), 'order-token');
    fs.writeFileSync(path.join(root, 'z-last.md'), 'order-token');
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'middle.md'), 'order-token');

    const byteOrder = searchNotesOracle(root, 'order-token');
    expect(byteOrder.results.map(result => result.path)).toEqual([
        'Needle.md',
        'a-first.md',
        'nested/middle.md',
        'z-last.md',
    ]);

    mocked.useWindowsDirectoryOrder = true;
    expect(searchNotesOracle(root, 'order-token')).toEqual(byteOrder);
});
