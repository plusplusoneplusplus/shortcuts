import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGE_TURNS } from '../src/history-paging';
import { PAGE_TURNS as rootPageTurns } from '../src/index';

describe('shared browser-safe history paging contract', () => {
    it('exports one fixed page size through the public package subpath and root', async () => {
        const shared = await import('@plusplusoneplusplus/coc-workflow/history-paging');
        expect(PAGE_TURNS).toBe(30);
        expect(shared.PAGE_TURNS).toBe(PAGE_TURNS);
        expect(rootPageTurns).toBe(PAGE_TURNS);
    });

    it('keeps the shared subpath independent of workflow runtime dependencies', () => {
        const source = readFileSync(new URL('../src/history-paging.ts', import.meta.url), 'utf8');
        expect(source).not.toMatch(/\bimport\b|\brequire\b|\bfrom\b/);
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        expect(manifest.exports['./history-paging']).toBe('./dist/history-paging.js');
        expect(manifest.typesVersions['*']['history-paging']).toEqual(['dist/history-paging.d.ts']);
    });
});
