/**
 * The SPA's Tailwind build only emits utilities found in `content` files.
 * Editor UI that moved into packages/tiptap-react (toolbar, TOC panel) is
 * styled with Tailwind utilities, so a missing glob would ship it unstyled
 * with no build or test error.
 */
import { globSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../tailwind.config.js';

const cocDir = path.resolve(__dirname, '../..');
const toPosix = (p: string) => p.split(path.sep).join('/');

describe('tailwind content', () => {
    it('scans every tiptap-react source file', () => {
        const scanned = new Set(
            (config.content as string[]).flatMap((pattern) =>
                globSync(pattern, { cwd: cocDir }).map((f) => toPosix(path.resolve(cocDir, f))),
            ),
        );
        const reactSrc = globSync('../tiptap-react/src/**/*.tsx', { cwd: cocDir })
            .map((f) => toPosix(path.resolve(cocDir, f)));
        expect(reactSrc.length).toBeGreaterThan(0);
        expect(reactSrc.some((f) => f.endsWith('/toolbar/ToolbarDropdown.tsx'))).toBe(true);
        expect(reactSrc.filter((f) => !scanned.has(f))).toEqual([]);
    });
});
