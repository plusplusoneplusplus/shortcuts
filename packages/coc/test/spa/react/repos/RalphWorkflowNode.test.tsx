/**
 * RalphWorkflowNode — narrow-card layout.
 *
 * The card lives in the Ralph pane's timeline column, which can be a few
 * hundred pixels wide. Truncating `Files:` / `Decisions:` / `Remaining:` to one
 * line there leaves a label and three characters, so below ~360px of card width
 * they clamp to two lines instead. jsdom does not evaluate container queries —
 * these assert the container and the variant classes are wired up.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RalphWorkflowNode } from '../../../../src/server/spa/client/react/features/chat/RalphWorkflowNode';
import type { ParsedProgressSection, RalphIterationRecord } from '@plusplusoneplusplus/coc-client';

const section: ParsedProgressSection = {
    iteration: 1,
    signal: 'RALPH_NEXT',
    timestamp: new Date().toISOString(),
    body: [
        'Files: packages/coc/src/server/spa/client/react/features/chat/RalphWorkflowPane.tsx',
        'Decisions: drive the split from the pane container',
        'Remaining: clamp the iteration card lines',
    ].join('\n'),
};

const record: RalphIterationRecord = {
    iteration: 1,
    taskId: 'task-1',
    processId: 'proc-1',
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    endedAt: new Date().toISOString(),
    status: 'completed',
    exitSignal: 'RALPH_NEXT',
};

describe('RalphWorkflowNode — narrow card layout', () => {
    it('is its own inline-size container', () => {
        render(<RalphWorkflowNode iteration={1} record={record} section={section} />);
        expect(screen.getByTestId('ralph-workflow-node-1').className).toContain('[container-type:inline-size]');
    });

    it('clamps the summary lines to two lines on a narrow card', () => {
        render(<RalphWorkflowNode iteration={1} record={record} section={section} />);
        const node = screen.getByTestId('ralph-workflow-node-1');
        const lines = Array.from(node.querySelectorAll('p'));
        expect(lines.length).toBe(3);
        for (const line of lines) {
            expect(line.className).toContain('truncate');
            expect(line.className).toContain('[@container_(max-width:359px)]:line-clamp-2');
            expect(line.className).toContain('[@container_(max-width:359px)]:whitespace-normal');
        }
    });

    it('lets the header wrap instead of squeezing the signal badge', () => {
        render(<RalphWorkflowNode iteration={1} record={record} section={section} />);
        const header = screen.getByText('Iter 1').parentElement;
        expect(header?.className).toContain('flex-wrap');
    });

    it('clamps an unstructured progress body too', () => {
        render(
            <RalphWorkflowNode
                iteration={2}
                section={{ ...section, iteration: 2, body: 'Investigated the flaky queue test.' }}
            />,
        );
        const line = screen.getByText('Investigated the flaky queue test.');
        expect(line.className).toContain('[@container_(max-width:359px)]:line-clamp-2');
    });
});
