/**
 * Tests for Breadcrumbs component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Breadcrumbs } from '../../../../../src/server/spa/client/react/repos/explorer/Breadcrumbs';

describe('Breadcrumbs', () => {
    it('renders repo name as root segment', () => {
        render(<Breadcrumbs segments={[]} onNavigate={vi.fn()} repoName="my-repo" />);
        const root = screen.getByTestId('breadcrumb-segment-root');
        expect(root.textContent).toContain('my-repo');
    });

    it('renders "root" as fallback when no repoName', () => {
        render(<Breadcrumbs segments={[]} onNavigate={vi.fn()} />);
        const root = screen.getByTestId('breadcrumb-segment-root');
        expect(root.textContent).toContain('root');
    });

    it('renders all segments with › separators', () => {
        render(<Breadcrumbs segments={['src', 'server', 'spa']} onNavigate={vi.fn()} repoName="repo" />);
        const nav = screen.getByTestId('explorer-breadcrumbs');
        // Three › separators (one before each segment)
        expect(nav.textContent).toContain('›');
        expect(screen.getByTestId('breadcrumb-segment-0')).toBeDefined();
        expect(screen.getByTestId('breadcrumb-segment-1')).toBeDefined();
        expect(screen.getByTestId('breadcrumb-segment-2')).toBeDefined();
    });

    it('last segment is not clickable (rendered as span)', () => {
        render(<Breadcrumbs segments={['src', 'lib']} onNavigate={vi.fn()} />);
        const lastSegment = screen.getByTestId('breadcrumb-segment-1');
        expect(lastSegment.tagName).toBe('SPAN');
    });

    it('non-last segments are clickable buttons', () => {
        render(<Breadcrumbs segments={['src', 'lib']} onNavigate={vi.fn()} />);
        const firstSegment = screen.getByTestId('breadcrumb-segment-0');
        expect(firstSegment.tagName).toBe('BUTTON');
    });

    it('calls onNavigate(index) when a segment button is clicked', () => {
        const onNavigate = vi.fn();
        render(<Breadcrumbs segments={['src', 'lib', 'utils']} onNavigate={onNavigate} />);
        fireEvent.click(screen.getByTestId('breadcrumb-segment-0'));
        expect(onNavigate).toHaveBeenCalledWith(0);
        fireEvent.click(screen.getByTestId('breadcrumb-segment-1'));
        expect(onNavigate).toHaveBeenCalledWith(1);
    });

    it('calls onNavigate(-1) when root segment is clicked', () => {
        const onNavigate = vi.fn();
        render(<Breadcrumbs segments={['src']} onNavigate={onNavigate} />);
        fireEvent.click(screen.getByTestId('breadcrumb-segment-root'));
        expect(onNavigate).toHaveBeenCalledWith(-1);
    });

    it('empty segments array renders only the root segment', () => {
        render(<Breadcrumbs segments={[]} onNavigate={vi.fn()} repoName="test" />);
        expect(screen.getByTestId('breadcrumb-segment-root')).toBeDefined();
        expect(screen.queryByTestId('breadcrumb-segment-0')).toBeNull();
    });

    it('has data-testid="explorer-breadcrumbs" on the nav element', () => {
        render(<Breadcrumbs segments={[]} onNavigate={vi.fn()} />);
        const nav = screen.getByTestId('explorer-breadcrumbs');
        expect(nav.tagName).toBe('NAV');
        expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
    });

    it('root segment shows 📂 icon', () => {
        render(<Breadcrumbs segments={[]} onNavigate={vi.fn()} repoName="repo" />);
        const root = screen.getByTestId('breadcrumb-segment-root');
        expect(root.textContent).toContain('📂');
    });
});
