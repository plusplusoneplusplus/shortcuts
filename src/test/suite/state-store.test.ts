/**
 * Unit tests for StateStore implementations (InMemoryStateStore, VscodeStateStore).
 */

import * as assert from 'assert';
import { InMemoryStateStore, VscodeStateStore } from '../../shortcuts/markdown-comments/state-store';

suite('InMemoryStateStore', () => {
    test('get returns defaultValue for missing key', () => {
        const store = new InMemoryStateStore();
        assert.deepStrictEqual(store.get('missing', []), []);
    });

    test('get returns defaultValue for missing key (undefined-like)', () => {
        const store = new InMemoryStateStore();
        assert.strictEqual(store.get('missing', 42), 42);
    });

    test('set then get round-trip (string)', async () => {
        const store = new InMemoryStateStore();
        await store.update('theme', 'dark');
        assert.strictEqual(store.get('theme', 'light'), 'dark');
    });

    test('set then get round-trip (complex object)', async () => {
        const store = new InMemoryStateStore();
        const obj = { mode: 'background', model: 'gpt-4' };
        await store.update('lastSelection', obj);
        assert.deepStrictEqual(store.get('lastSelection', {}), obj);
    });

    test('set overwrites previous value', async () => {
        const store = new InMemoryStateStore();
        await store.update('key', 'first');
        await store.update('key', 'second');
        assert.strictEqual(store.get('key', ''), 'second');
    });

    test('clear removes all keys', async () => {
        const store = new InMemoryStateStore();
        await store.update('a', 1);
        await store.update('b', 2);
        store.clear();
        assert.strictEqual(store.get('a', 0), 0);
        assert.strictEqual(store.get('b', 0), 0);
    });

    test('keys returns stored key names', async () => {
        const store = new InMemoryStateStore();
        await store.update('x', 1);
        await store.update('y', 2);
        assert.deepStrictEqual(store.keys().sort(), ['x', 'y']);
    });

    test('update returns a Promise', () => {
        const store = new InMemoryStateStore();
        const result = store.update('k', 'v');
        assert.ok(result instanceof Promise);
    });
});

suite('VscodeStateStore', () => {
    /** Create a minimal mock Memento. */
    function createMockMemento() {
        const data = new Map<string, unknown>();
        return {
            data,
            getCalls: [] as Array<{ key: string; defaultValue: unknown }>,
            updateCalls: [] as Array<{ key: string; value: unknown }>,
            keys(): readonly string[] {
                return Array.from(data.keys());
            },
            get<T>(key: string, defaultValue?: T): T | undefined {
                this.getCalls.push({ key, defaultValue });
                return data.has(key) ? data.get(key) as T : defaultValue;
            },
            async update(key: string, value: unknown): Promise<void> {
                this.updateCalls.push({ key, value });
                data.set(key, value);
            },
            setKeysForSync(): void { /* no-op */ }
        };
    }

    test('delegates get to Memento', () => {
        const memento = createMockMemento();
        const store = new VscodeStateStore(memento as any);
        memento.data.set('color', 'blue');

        const result = store.get('color', 'red');
        assert.strictEqual(result, 'blue');
        assert.strictEqual(memento.getCalls.length, 1);
        assert.strictEqual(memento.getCalls[0].key, 'color');
    });

    test('delegates set to Memento.update', async () => {
        const memento = createMockMemento();
        const store = new VscodeStateStore(memento as any);

        await store.update('theme', 'dark');
        assert.strictEqual(memento.updateCalls.length, 1);
        assert.strictEqual(memento.updateCalls[0].key, 'theme');
        assert.strictEqual(memento.updateCalls[0].value, 'dark');
    });

    test('keys delegates to Memento.keys', () => {
        const memento = createMockMemento();
        memento.data.set('a', 1);
        memento.data.set('b', 2);
        const store = new VscodeStateStore(memento as any);

        assert.deepStrictEqual(store.keys().sort(), ['a', 'b']);
    });

    test('get returns defaultValue for missing key', () => {
        const memento = createMockMemento();
        const store = new VscodeStateStore(memento as any);
        assert.deepStrictEqual(store.get('missing', []), []);
    });
});
