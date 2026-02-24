import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const wikiDetailPath = resolve(
    __dirname,
    '../../../src/server/spa/client/react/wiki/WikiDetail.tsx',
);
const wikiDetailSource = readFileSync(wikiDetailPath, 'utf-8');

describe('WikiDetail layout constraints', () => {
    it('keeps the wiki shell viewport height fixed with overflow hidden', () => {
        expect(wikiDetailSource).toContain('h-[calc(100vh-48px)] overflow-hidden');
    });

    it('keeps the right content pane min-h-0 so child views can scroll', () => {
        expect(wikiDetailSource).toContain('flex-1 min-w-0 min-h-0 overflow-hidden');
    });
});
