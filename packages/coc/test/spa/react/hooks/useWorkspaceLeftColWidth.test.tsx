/**
 * usePublishWorkspaceLeftColWidth — publishes a left-column width to the
 * `--workspace-left-col-width` CSS variable so the app-shell GlobalStatusDock
 * can size its bottom bar flush under the current view's left panel.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
    usePublishWorkspaceLeftColWidth,
    WORKSPACE_LEFT_COL_WIDTH_VAR,
} from '../../../../src/server/spa/client/react/hooks/ui/useWorkspaceLeftColWidth';

const readVar = () => document.documentElement.style.getPropertyValue(WORKSPACE_LEFT_COL_WIDTH_VAR);

function Harness({ width, disabled }: { width: number; disabled: boolean }) {
    usePublishWorkspaceLeftColWidth(width, disabled);
    return null;
}

beforeEach(() => {
    document.documentElement.style.removeProperty(WORKSPACE_LEFT_COL_WIDTH_VAR);
});

describe('usePublishWorkspaceLeftColWidth', () => {
    it('publishes the width in px while enabled', () => {
        render(<Harness width={280} disabled={false} />);
        expect(readVar()).toBe('280px');
    });

    it('does not publish (and clears) while disabled', () => {
        document.documentElement.style.setProperty(WORKSPACE_LEFT_COL_WIDTH_VAR, '999px');
        render(<Harness width={280} disabled={true} />);
        expect(readVar()).toBe('');
    });

    it('tracks width changes', () => {
        const { rerender } = render(<Harness width={280} disabled={false} />);
        expect(readVar()).toBe('280px');
        rerender(<Harness width={321} disabled={false} />);
        expect(readVar()).toBe('321px');
    });

    it('clears when it flips from enabled to disabled (e.g. tab becomes inactive)', () => {
        const { rerender } = render(<Harness width={280} disabled={false} />);
        expect(readVar()).toBe('280px');
        rerender(<Harness width={280} disabled={true} />);
        expect(readVar()).toBe('');
    });

    it('clears the variable on unmount so the dock falls back', () => {
        const { unmount } = render(<Harness width={280} disabled={false} />);
        expect(readVar()).toBe('280px');
        unmount();
        expect(readVar()).toBe('');
    });
});
