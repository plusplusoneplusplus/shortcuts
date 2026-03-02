/**
 * Tests for the shared FilePathLink component.
 */
/* @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { FilePathLink } from '../../../src/server/spa/client/react/shared/FilePathLink';

describe('FilePathLink', () => {
    it('renders a span with file-path-link class', () => {
        const { container } = render(<FilePathLink path="/Users/alice/code/app.ts" />);
        const span = container.querySelector('.file-path-link');
        expect(span).not.toBeNull();
    });

    it('sets data-full-path with normalized forward slashes', () => {
        const { container } = render(<FilePathLink path="C:/Users/alice/app.ts" />);
        const span = container.querySelector('.file-path-link');
        expect(span?.getAttribute('data-full-path')).toBe('C:/Users/alice/app.ts');
    });

    it('sets title to normalized path', () => {
        const { container } = render(<FilePathLink path="/Users/alice/code/foo.ts" />);
        const span = container.querySelector('.file-path-link');
        expect(span?.getAttribute('title')).toBe('/Users/alice/code/foo.ts');
    });

    it('displays shortened path by default', () => {
        const { container } = render(<FilePathLink path="/Users/alice/code/foo.ts" />);
        const span = container.querySelector('.file-path-link');
        expect(span?.textContent).toBe('~/code/foo.ts');
    });

    it('displays full path when shorten is false', () => {
        const { container } = render(<FilePathLink path="/Users/alice/code/foo.ts" shorten={false} />);
        const span = container.querySelector('.file-path-link');
        expect(span?.textContent).toBe('/Users/alice/code/foo.ts');
    });

    it('applies custom className', () => {
        const { container } = render(<FilePathLink path="/tmp/test.ts" className="text-red" />);
        const span = container.querySelector('.file-path-link');
        expect(span?.className).toContain('text-red');
    });

    it('includes break-all class', () => {
        const { container } = render(<FilePathLink path="/tmp/test.ts" />);
        const span = container.querySelector('.file-path-link');
        expect(span?.className).toContain('break-all');
    });

    it('returns null for empty path', () => {
        const { container } = render(<FilePathLink path="" />);
        expect(container.querySelector('.file-path-link')).toBeNull();
    });

    it('shortens Documents/Projects paths', () => {
        const { container } = render(
            <FilePathLink path="/Users/alice/Documents/Projects/repo/src/main.ts" />
        );
        const span = container.querySelector('.file-path-link');
        expect(span?.textContent).toBe('repo/src/main.ts');
    });

    it('shortens Windows Documents/Projects paths', () => {
        const { container } = render(
            <FilePathLink path="D:/Users/carol/Documents/Projects/repo/main.ts" />
        );
        const span = container.querySelector('.file-path-link');
        expect(span?.textContent).toBe('repo/main.ts');
    });
});
