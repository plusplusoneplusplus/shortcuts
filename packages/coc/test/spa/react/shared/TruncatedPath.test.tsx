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
        expect(el.children).toHaveLength(1);
    });

    it('splits path into directory prefix and filename', () => {
        render(<TruncatedPath path="packages/coc/src/index.ts" />);
        const el = screen.getByTitle('packages/coc/src/index.ts');
        expect(el).toBeDefined();
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

    it('applies whitespace-nowrap on the directory prefix', () => {
        render(<TruncatedPath path="a/b/c/file.ts" />);
        const el = screen.getByTitle('a/b/c/file.ts');
        const dirSpan = el.children[0] as HTMLElement;
        expect(dirSpan.className).toContain('whitespace-nowrap');
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
        // leading empty segment + filename => dir="/", shows 2 children
        expect(el.children).toHaveLength(2);
        expect(el.children[0].textContent).toBe('/');
        expect(el.children[1].textContent).toBe('file.ts');
    });

    it('preserves full text content for paths within maxSegments', () => {
        const path = 'packages/coc/src/server/handler.ts';
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        expect(el.textContent).toBe(path);
    });

    // --- JS-level middle-truncation tests ---

    it('does not truncate paths with segments <= maxSegments (default 5)', () => {
        const path = 'packages/coc/src/server/handler.ts'; // 4 dir segments
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        expect(el.children[0].textContent).toBe('packages/coc/src/server/');
        expect(el.children[1].textContent).toBe('handler.ts');
    });

    it('does not truncate paths with exactly maxSegments dir segments', () => {
        const path = 'a/b/c/d/e/file.ts'; // 5 dir segments = default maxSegments
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        expect(el.children[0].textContent).toBe('a/b/c/d/e/');
        expect(el.children[1].textContent).toBe('file.ts');
    });

    it('middle-truncates deeply nested paths (default maxSegments=5)', () => {
        const path = 'packages/coc/src/server/spa/client/react/features/templates/hooks/useScriptTemplates.ts';
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        // 10 dir segments > 5: head=3, tail=2 → packages/coc/src/…/templates/hooks/
        expect(el.children[0].textContent).toBe('packages/coc/src/…/templates/hooks/');
        expect(el.children[1].textContent).toBe('useScriptTemplates.ts');
    });

    it('middle-truncates with 6 dir segments (just over default)', () => {
        const path = 'a/b/c/d/e/f/file.ts'; // 6 dir segments
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        // head=3, tail=2 → a/b/c/…/e/f/
        expect(el.children[0].textContent).toBe('a/b/c/…/e/f/');
        expect(el.children[1].textContent).toBe('file.ts');
    });

    it('respects custom maxSegments prop', () => {
        const path = 'a/b/c/d/e/f/file.ts'; // 6 dir segments
        render(<TruncatedPath path={path} maxSegments={3} />);
        const el = screen.getByTitle(path);
        // maxSegments=3: head=2, tail=1 → a/b/…/f/
        expect(el.children[0].textContent).toBe('a/b/…/f/');
        expect(el.children[1].textContent).toBe('file.ts');
    });

    it('handles maxSegments=1', () => {
        const path = 'a/b/c/d/file.ts'; // 4 dir segments
        render(<TruncatedPath path={path} maxSegments={1} />);
        const el = screen.getByTitle(path);
        // head=1, tail=0 → a/…/
        expect(el.children[0].textContent).toBe('a/…/');
        expect(el.children[1].textContent).toBe('file.ts');
    });

    it('handles maxSegments=2', () => {
        const path = 'a/b/c/d/file.ts'; // 4 dir segments
        render(<TruncatedPath path={path} maxSegments={2} />);
        const el = screen.getByTitle(path);
        // head=1, tail=1 → a/…/d/
        expect(el.children[0].textContent).toBe('a/…/d/');
        expect(el.children[1].textContent).toBe('file.ts');
    });

    it('handles Windows-style backslash paths', () => {
        const path = 'packages\\coc\\src\\server\\spa\\client\\react\\hooks\\useScriptTemplates.ts';
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        // 8 dir segments > 5: head=3, tail=2 → packages\coc\src\…\react\hooks\
        expect(el.children[0].textContent).toBe('packages\\coc\\src\\…\\react\\hooks\\');
        expect(el.children[1].textContent).toBe('useScriptTemplates.ts');
    });

    it('handles Windows paths within maxSegments', () => {
        const path = 'src\\server\\index.ts'; // 2 dir segments
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        expect(el.children[0].textContent).toBe('src\\server\\');
        expect(el.children[1].textContent).toBe('index.ts');
    });

    it('title tooltip always shows the full untruncated path', () => {
        const path = 'a/b/c/d/e/f/g/h/deep.tsx';
        render(<TruncatedPath path={path} />);
        const el = screen.getByTitle(path);
        expect(el.getAttribute('title')).toBe(path);
    });
});
