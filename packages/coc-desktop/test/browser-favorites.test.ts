import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserFavoritesStore, BROWSER_FAVORITES_MAX_ENTRIES } from '../src/browser-favorites';

const directories: string[] = [];
function directory(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-browser-favorites-'));
    directories.push(dir);
    return dir;
}
function seed(dir: string, data: unknown): void {
    fs.mkdirSync(path.join(dir, 'browser'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'browser', 'favorites.json'), JSON.stringify(data));
}
afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of directories) fs.rmSync(dir, { recursive: true, force: true });
    directories.length = 0;
});

describe('desktop browser favorites store', () => {
    it('persists newest-first favorites across instances, strips credentials and dedupes by URL', async () => {
        const dir = directory();
        let now = 100;
        const changed = vi.fn();
        const store = new BrowserFavoritesStore(dir, () => now, changed);
        expect(await store.add('https://user:secret@a.test/Path?q=1#x', 'A')).toBe(true);
        now = 200;
        expect(await store.add('https://b.test/', 'B')).toBe(true);
        expect(await store.add('https://a.test/Path?q=1#x', 'A')).toBe(false);
        expect(await store.add('https://a.test/Path?q=1#x', 'A renamed')).toBe(true);
        expect(changed).toHaveBeenCalledTimes(3);
        const reopened = new BrowserFavoritesStore(dir);
        expect(await reopened.list()).toEqual({ storageError: null, favorites: [
            { url: 'https://b.test/', title: 'B', added: 200 },
            { url: 'https://a.test/Path?q=1#x', title: 'A renamed', added: 100 },
        ] });
        expect(fs.readFileSync(reopened.filename, 'utf8')).not.toContain('secret');
        expect(await reopened.remove('https://b.test/')).toBe(true);
        expect(await reopened.remove('https://b.test/')).toBe(false);
        expect((await new BrowserFavoritesStore(dir).list()).favorites.map(item => item.url)).toEqual(['https://a.test/Path?q=1#x']);
    });

    it('rejects non-web URLs and non-string titles without writing', async () => {
        const dir = directory();
        const store = new BrowserFavoritesStore(dir);
        for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'about:blank', 42, null]) {
            await expect(store.add(url, 'x')).rejects.toBeInstanceOf(TypeError);
            await expect(store.remove(url)).rejects.toBeInstanceOf(TypeError);
        }
        await expect(store.add('https://a.test/', {})).rejects.toBeInstanceOf(TypeError);
        expect(fs.existsSync(store.filename)).toBe(false);
    });

    it('drops invalid persisted rows, bounds titles and caps the list', async () => {
        const dir = directory();
        seed(dir, { version: 1, favorites: [
            { url: 'https://ok.test/', title: 'x'.repeat(2000), added: 1 },
            { url: 'https://ok.test/', title: 'duplicate', added: 2 },
            { url: 'file:///secret', title: 'file', added: 1 },
            { url: 'https://bad-time.test/', title: 'bad', added: -1 },
            { url: 'https://no-title.test/' , added: 1 },
        ] });
        const store = new BrowserFavoritesStore(dir);
        const { favorites } = await store.list();
        expect(favorites.map(item => item.url)).toEqual(['https://ok.test/']);
        expect(favorites[0].title).toHaveLength(1024);

        const full = directory();
        seed(full, { version: 1, favorites: Array.from({ length: BROWSER_FAVORITES_MAX_ENTRIES }, (_, i) =>
            ({ url: `https://site${i}.test/`, title: '', added: i })) });
        const fullStore = new BrowserFavoritesStore(full);
        await expect(fullStore.add('https://new.test/', 'New')).rejects.toBeInstanceOf(RangeError);
        expect(await fullStore.add('https://site0.test/', 'Renamed')).toBe(true);
    });

    it('reports corrupt storage and failed saves, then recovers on the next save', async () => {
        const dir = directory();
        seed(dir, { version: 2 });
        const store = new BrowserFavoritesStore(dir);
        expect((await store.list()).storageError).toContain('invalid');
        const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk full'));
        await expect(store.add('https://a.test/', 'A')).rejects.toThrow('disk full');
        expect(await store.list()).toMatchObject({ favorites: [], storageError: expect.stringContaining('disk full') });
        rename.mockRestore();
        expect(await store.add('https://a.test/', 'A')).toBe(true);
        expect(await store.list()).toMatchObject({ favorites: [{ url: 'https://a.test/' }], storageError: null });
    });
});
