import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { WorkItemTreeNode } from '@plusplusoneplusplus/coc-client';
import { WorkItemGitHubMirrorBadge } from '../../../../src/server/spa/client/react/features/work-items/WorkItemGitHubMirrorBadge';
import { WorkItemHierarchyNode } from '../../../../src/server/spa/client/react/features/work-items/WorkItemHierarchyNode';

const isoDate = '2026-06-08T00:00:00.000Z';

function makeNode(overrides: Partial<WorkItemTreeNode['item']> = {}): WorkItemTreeNode {
    return {
        item: {
            id: 'wi-1',
            repoId: 'repo-1',
            title: 'Implement remote tree cleanup',
            description: '',
            status: 'created',
            type: 'work-item',
            workItemNumber: 8,
            createdAt: isoDate,
            updatedAt: isoDate,
            ...overrides,
        },
        children: [],
        rollup: {
            descendantCount: 0,
            byType: {
                epic: 0,
                feature: 0,
                pbi: 0,
                'work-item': 0,
                bug: 0,
                goal: 0,
            },
            byStatus: {
                created: 0,
                drafting: 0,
                planning: 0,
                readyToExecute: 0,
                executing: 0,
                aiDone: 0,
                aiFailed: 0,
                done: 0,
                failed: 0,
            },
        },
    };
}

function renderNode(node: WorkItemTreeNode, remoteView = false) {
    return render(
        <WorkItemHierarchyNode
            node={node}
            depth={0}
            collapsed={false}
            selected={false}
            hasChildren={node.children.length > 0}
            remoteView={remoteView}
            onSelect={vi.fn()}
            onToggleCollapse={vi.fn()}
            onContextMenu={vi.fn()}
            sessionContextPayload={null}
        />
    );
}

describe('WorkItemHierarchyNode', () => {
    it('keeps local work item numbers and status chips in local trees', () => {
        const node = makeNode();

        renderNode(node);

        const row = screen.getByTestId('hierarchy-node-row-wi-1');
        expect(within(row).getByText('WI-8')).toBeInTheDocument();
        expect(screen.getByTestId('hierarchy-node-status-wi-1')).toHaveTextContent('Created');
    });

    it('hides local work item numbers and leaf status chips in remote trees', () => {
        const node = makeNode({
            githubMirror: {
                owner: 'octo',
                repo: 'repo',
                issueNumber: 298,
                issueUrl: 'https://github.com/octo/repo/issues/298',
                lastSyncedAt: isoDate,
            },
        });

        renderNode(node, true);

        const row = screen.getByTestId('hierarchy-node-row-wi-1');
        expect(within(row).queryByText('WI-8')).not.toBeInTheDocument();
        expect(screen.queryByTestId('hierarchy-node-status-wi-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('hierarchy-node-remote-mirror-badge-wi-1')).toHaveTextContent('298');
    });

    it('still shows container rollups in remote trees', () => {
        const node = makeNode({
            id: 'epic-1',
            title: 'CoC root epic',
            type: 'epic',
            workItemNumber: 2,
        });
        node.rollup.descendantCount = 7;
        node.rollup.byStatus.done = 3;

        renderNode(node, true);

        const row = screen.getByTestId('hierarchy-node-row-epic-1');
        expect(within(row).queryByText('E-2')).not.toBeInTheDocument();
        expect(within(row).getByText('3/7')).toBeInTheDocument();
    });
});

describe('WorkItemGitHubMirrorBadge', () => {
    it('renders compact GitHub badges as issue numbers only', () => {
        render(
            <WorkItemGitHubMirrorBadge
                compact
                mirror={{
                    owner: 'octo',
                    repo: 'repo',
                    issueNumber: 269,
                    issueUrl: 'https://github.com/octo/repo/issues/269',
                    state: 'open',
                    lastSyncedAt: isoDate,
                }}
                data-testid="github-badge"
            />
        );

        expect(screen.getByTestId('github-badge')).toHaveTextContent('269');
        expect(screen.queryByText('GH#269')).not.toBeInTheDocument();
    });
});
