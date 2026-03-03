import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const wikiDetailPath = resolve(
    __dirname,
    '../../../src/server/spa/client/react/wiki/WikiDetail.tsx',
);
const wikiDetailSource = readFileSync(wikiDetailPath, 'utf-8');

describe('WikiDetail layout constraints', () => {
    it('uses conditional height: h-full when embedded, calc height otherwise', () => {
        expect(wikiDetailSource).toContain("embedded ? 'h-full' : 'h-[calc(100vh-48px-56px)] md:h-[calc(100vh-48px)]'");
    });

    it('keeps the right content pane min-h-0 so child views can scroll', () => {
        expect(wikiDetailSource).toContain('flex-1 min-w-0 min-h-0 overflow-hidden');
    });

    it('hides back button when embedded', () => {
        expect(wikiDetailSource).toContain('{!embedded && (');
    });

    it('shows compact tab bar when embedded', () => {
        expect(wikiDetailSource).toContain('{embedded && (');
    });
});
