/**
 * Tests for TruncatedPath shared component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TruncatedPath } from '../../../../src/server/spa/client/react/shared/TruncatedPath';

describe('TruncatedPath', () => {
    it('renders nothing for empty path', () => {
        const { container } = render(<TruncatedPath path="" />);
        expect(container.innerHTML).toBe('');
    });

    it('renders filename only when path has no directory', () => {
        render(<TruncatedPath path="README.md" />);
        const el = screen.getByTitle('README.md');
        expect(el).toBeDefined();
        expect(el.textContent).toBe('README.md');
        // Should have a single child span (the filename)
        expect(el.children).toHaveLength(1);
    });

    it('splits path into directory prefix and filename', () => {
        render(<TruncatedPath path="packages/coc/src/index.ts" />);
        const el = screen.getByTitle('packages/coc/src/index.ts');
        expect(el).toBeDefined();
        // Two child spans: dir prefix + filename
        expect(el.children).toHaveLength(2);
        expect(el.children[0].textContent).toBe('packages/coc/src/');
        expect(el.children[1].textContent).toBe('index.ts');
    });

    it('sets title attribute with full path for tooltip', () => {
        const fullPath = 'packages/coc/src/server/spa/client/react/shared/TruncatedPath.tsx';
        render(<TruncatedPath path={fullPath} />);
        const el = screen.getByTitle(fullPath);
        expect(el).toBeDefined();
    });

    it('applies the truncate class on the directory prefix', () => {
        render(<TruncatedPath path="a/b/c/file.ts" />);
        const el = screen.getByTitle('a/b/c/file.ts');
        const dirSpan = el.children[0] as HTMLElement;
        expect(dirSpan.className).toContain('truncate');
    });

    it('applies flex-shrink-0 on the filename span', () => {
        render(<TruncatedPath path="a/b/c/file.ts" />);
        const el = screen.getByTitle('a/b/c/file.ts');
        const fileSpan = el.children[1] as HTMLElement;
        expect(fileSpan.className).toContain('flex-shrink-0');
    });

    it('applies overflow-hidden on the outer span to prevent content overflow', () => {
        render(<TruncatedPath path="a/b/c/file.ts" />);
        const el = screen.getByTitle('a/b/c/file.ts');
        expect(el.className).toContain('overflow-hidden');
    });

    it('applies custom className', () => {
        render(<TruncatedPath path="a/file.ts" className="text-red-500" />);
        const el = screen.getByTitle('a/file.ts');
        expect(el.className).toContain('text-red-500');
    });

    it('handles root-level file (leading slash)', () => {
        render(<TruncatedPath path="/file.ts" />);
        const el = screen.getByTitle('/file.ts');
        // sep=0 means dirPrefix is empty (sep > 0 check), so only filename span
        expect(el.children).toHaveLength(1);
        expect(el.textContent).toBe('file.ts');
    });

    it('preserves full text content of the path', () => {
        const path = 'packages/coc/src/server/handler.ts';
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        expect(el.textContent).toBe(path);
    });

    it('handles deeply nested paths', () => {
        const path = 'a/b/c/d/e/f/g/h/deep.tsx';
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        expect(el.children[0].textContent).toBe('a/b/c/d/e/f/g/h/');
        expect(el.children[1].textContent).toBe('deep.tsx');
    });
});
