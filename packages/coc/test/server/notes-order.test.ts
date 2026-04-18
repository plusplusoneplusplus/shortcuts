/**
 * notes-order — unit tests for the .order.json persistence helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    readOrderFile,
    writeOrderFile,
    removeFromOrder,
    updateOrderOnRename,
    applyOrder,
    ORDER_FILE_NAME,
} from '../../src/server/notes-order';

// ── Helpers ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-order-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── readOrderFile ──────────────────────────────────────────────────────

describe('readOrderFile', () => {
    it('returns [] when .order.json does not exist', async () => {
        const result = await readOrderFile(tmpDir);
        expect(result).toEqual([]);
    });

    it('returns [] when .order.json is malformed JSON', async () => {
        fs.writeFileSync(path.join(tmpDir, ORDER_FILE_NAME), 'not json', 'utf-8');
        const result = await readOrderFile(tmpDir);
        expect(result).toEqual([]);
    });

    it('returns [] when .order.json has no order array', async () => {
        fs.writeFileSync(path.join(tmpDir, ORDER_FILE_NAME), JSON.stringify({ foo: 'bar' }), 'utf-8');
        const result = await readOrderFile(tmpDir);
        expect(result).toEqual([]);
    });

    it('returns the order array when .order.json is valid', async () => {
        fs.writeFileSync(path.join(tmpDir, ORDER_FILE_NAME), JSON.stringify({ order: ['b', 'a', 'c'] }), 'utf-8');
        const result = await readOrderFile(tmpDir);
        expect(result).toEqual(['b', 'a', 'c']);
    });
});

// ── writeOrderFile ─────────────────────────────────────────────────────

describe('writeOrderFile', () => {
    it('creates .order.json with given names', async () => {
        await writeOrderFile(tmpDir, ['x', 'y', 'z']);
        const raw = fs.readFileSync(path.join(tmpDir, ORDER_FILE_NAME), 'utf-8');
        const parsed = JSON.parse(raw);
        expect(parsed.order).toEqual(['x', 'y', 'z']);
    });

    it('overwrites existing .order.json', async () => {
        await writeOrderFile(tmpDir, ['a', 'b']);
        await writeOrderFile(tmpDir, ['c', 'd', 'e']);
        const raw = fs.readFileSync(path.join(tmpDir, ORDER_FILE_NAME), 'utf-8');
        expect(JSON.parse(raw).order).toEqual(['c', 'd', 'e']);
    });
});

// ── removeFromOrder ────────────────────────────────────────────────────

describe('removeFromOrder', () => {
    it('removes the named entry from .order.json', async () => {
        await writeOrderFile(tmpDir, ['a', 'b', 'c']);
        await removeFromOrder(tmpDir, 'b');
        const order = await readOrderFile(tmpDir);
        expect(order).toEqual(['a', 'c']);
    });

    it('no-ops when .order.json does not exist', async () => {
        await expect(removeFromOrder(tmpDir, 'x')).resolves.not.toThrow();
    });

    it('no-ops when name is not present in order', async () => {
        await writeOrderFile(tmpDir, ['a', 'b']);
        await removeFromOrder(tmpDir, 'z');
        const order = await readOrderFile(tmpDir);
        expect(order).toEqual(['a', 'b']);
    });

    it('does not rewrite file when name is absent (file unchanged)', async () => {
        await writeOrderFile(tmpDir, ['a', 'b']);
        const before = fs.statSync(path.join(tmpDir, ORDER_FILE_NAME)).mtimeMs;
        await removeFromOrder(tmpDir, 'z'); // not present
        const after = fs.statSync(path.join(tmpDir, ORDER_FILE_NAME)).mtimeMs;
        // mtime should be unchanged (file not rewritten)
        expect(after).toBe(before);
    });
});

// ── updateOrderOnRename ────────────────────────────────────────────────

describe('updateOrderOnRename', () => {
    it('renames an entry within .order.json', async () => {
        await writeOrderFile(tmpDir, ['a', 'b', 'c']);
        await updateOrderOnRename(tmpDir, 'b', 'beta');
        const order = await readOrderFile(tmpDir);
        expect(order).toEqual(['a', 'beta', 'c']);
    });

    it('no-ops when .order.json does not exist', async () => {
        await expect(updateOrderOnRename(tmpDir, 'a', 'b')).resolves.not.toThrow();
    });

    it('no-ops when old name is not present', async () => {
        await writeOrderFile(tmpDir, ['a', 'b']);
        await updateOrderOnRename(tmpDir, 'z', 'new');
        const order = await readOrderFile(tmpDir);
        expect(order).toEqual(['a', 'b']);
    });
});

// ── applyOrder ─────────────────────────────────────────────────────────

describe('applyOrder', () => {
    const items = ['alpha', 'beta', 'gamma', 'delta'];
    const id = (s: string) => s;

    it('returns items unchanged when explicitOrder is empty', () => {
        const result = applyOrder(items, id, []);
        expect(result).toEqual(items);
    });

    it('places explicitly-ordered items first in specified order', () => {
        const result = applyOrder(items, id, ['gamma', 'alpha']);
        expect(result).toEqual(['gamma', 'alpha', 'beta', 'delta']);
    });

    it('unlisted items preserve their original relative order', () => {
        // items = ['alpha','beta','gamma','delta'], order first = ['delta']
        // unlisted = ['alpha','beta','gamma'] — should stay in that order
        const result = applyOrder(items, id, ['delta']);
        expect(result).toEqual(['delta', 'alpha', 'beta', 'gamma']);
    });

    it('handles explicit order with all items', () => {
        const result = applyOrder(items, id, ['delta', 'gamma', 'beta', 'alpha']);
        expect(result).toEqual(['delta', 'gamma', 'beta', 'alpha']);
    });

    it('ignores names in explicitOrder that are not in items', () => {
        const result = applyOrder(items, id, ['nonexistent', 'beta']);
        expect(result).toEqual(['beta', 'alpha', 'gamma', 'delta']);
    });

    it('works with objects using a custom getName function', () => {
        const objs = [{ name: 'b' }, { name: 'a' }, { name: 'c' }];
        const result = applyOrder(objs, o => o.name, ['c', 'a']);
        expect(result.map(o => o.name)).toEqual(['c', 'a', 'b']);
    });
});
