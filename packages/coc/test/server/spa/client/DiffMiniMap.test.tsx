/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    computeSegmentPositions,
    measureLineOffsets,
    type DiffSegment,
} from '../../../../src/server/spa/client/react/features/git/diff/DiffMiniMap';
import { SideBySideDiffViewer } from '../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer';

describe('DiffMiniMap geometry helpers', () => {
    it('indexes measured line offsets by diff line index and unions duplicate split cells', () => {
        const container = document.createElement('div');
        Object.defineProperty(container, 'scrollTop', { value: 20, configurable: true });
        Object.defineProperty(container, 'scrollHeight', { value: 500, configurable: true });
        container.getBoundingClientRect = () => ({ top: 100 } as DOMRect);

        const appendLine = (index: number, top: number, height: number) => {
            const el = document.createElement('div');
            el.setAttribute('data-diff-line-index', String(index));
            el.getBoundingClientRect = () => ({ top, height } as DOMRect);
            container.appendChild(el);
        };

        appendLine(2, 140, 10);
        appendLine(0, 110, 20);
        appendLine(2, 135, 30);

        const { offsets, totalHeight } = measureLineOffsets(container);

        expect(totalHeight).toBe(500);
        expect(offsets[0]).toEqual({ top: 30, height: 20 });
        expect(offsets[1]).toBeUndefined();
        expect(offsets[2]).toEqual({ top: 55, height: 30 });
    });

    it('computes segment positions from sparse measured offsets', () => {
        const segments: DiffSegment[] = [
            { type: 'added', startLine: 1, lineCount: 4 },
            { type: 'removed', startLine: 6, lineCount: 2 },
        ];

        const positions = computeSegmentPositions(
            segments,
            [
                undefined,
                undefined,
                { top: 100, height: 20 },
                undefined,
                { top: 160, height: 30 },
                undefined,
                undefined,
                undefined,
            ],
            400,
        );

        expect(positions[0]).toEqual({ topPercent: 25, heightPercent: 22.5 });
        expect(positions[1]).toEqual({ topPercent: 0, heightPercent: 0 });
    });
});

describe('SideBySideDiffViewer minimap anchors', () => {
    it('renders diff line anchors when comments are disabled', () => {
        render(
            <SideBySideDiffViewer
                diff={[
                    'diff --git a/file.ts b/file.ts',
                    'index 111..222 100644',
                    '--- a/file.ts',
                    '+++ b/file.ts',
                    '@@ -1,2 +1,2 @@',
                    ' const unchanged = true;',
                    '-const oldValue = 1;',
                    '+const newValue = 2;',
                ].join('\n')}
                data-testid="split-diff"
            />,
        );

        const viewer = screen.getByTestId('split-diff');
        expect(viewer.querySelector('[data-hunk-header]')?.getAttribute('data-diff-line-index')).toBe('4');
        expect(viewer.querySelector('[data-split-side="left"]')?.getAttribute('data-diff-line-index')).toBe('5');
        expect(viewer.querySelector('[data-split-side="right"]')?.getAttribute('data-diff-line-index')).toBe('5');
    });
});
