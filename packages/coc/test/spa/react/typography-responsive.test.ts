import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const tailwindCss = readFileSync(
    resolve(__dirname, '../../../src/server/spa/client/tailwind.css'),
    'utf-8'
);

describe('Responsive typography and utilities in tailwind.css', () => {
    it('contains responsive body text classes (text-sm lg:text-base)', () => {
        expect(tailwindCss).toContain('text-sm');
        expect(tailwindCss).toContain('lg:text-base');
    });

    it('contains responsive h1 classes (text-xl lg:text-2xl)', () => {
        expect(tailwindCss).toMatch(/h1\s*\{[^}]*text-xl/);
        expect(tailwindCss).toMatch(/h1\s*\{[^}]*lg:text-2xl/);
    });

    it('contains responsive h2 classes (text-lg lg:text-xl)', () => {
        expect(tailwindCss).toMatch(/h2\s*\{[^}]*text-lg/);
        expect(tailwindCss).toMatch(/h2\s*\{[^}]*lg:text-xl/);
    });

    it('contains responsive h3 classes (text-base lg:text-lg)', () => {
        expect(tailwindCss).toMatch(/h3\s*\{[^}]*text-base/);
        expect(tailwindCss).toMatch(/h3\s*\{[^}]*lg:text-lg/);
    });

    it('contains responsive h4 classes (text-sm lg:text-base)', () => {
        expect(tailwindCss).toMatch(/h4\s*\{[^}]*text-sm/);
        expect(tailwindCss).toMatch(/h4\s*\{[^}]*lg:text-base/);
    });

    it('defines .touch-target utility with min-h-[44px]', () => {
        expect(tailwindCss).toContain('.touch-target');
        expect(tailwindCss).toContain('min-h-[44px]');
        expect(tailwindCss).toContain('min-w-[44px]');
    });

    it('defines .touch-target with desktop reset (md:min-h-0 md:min-w-0)', () => {
        expect(tailwindCss).toContain('md:min-h-0');
        expect(tailwindCss).toContain('md:min-w-0');
    });

    it('defines .responsive-container with p-3 md:p-4 lg:p-6', () => {
        expect(tailwindCss).toContain('.responsive-container');
        expect(tailwindCss).toContain('p-3');
        expect(tailwindCss).toContain('md:p-4');
        expect(tailwindCss).toContain('lg:p-6');
    });
});
