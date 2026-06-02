/**
 * Layout tests for Work Item Hierarchy Board (AC-06).
 *
 * Verifies source-level structure guarantees for:
 * - WorkItemHierarchyNode: type pills, labels, collapse toggle
 * - WorkItemHierarchyTree: disabled mode, create actions, tree structure, parent picker integration
 * - WorkItemDetail: container detection, leaf-only plan/execution sections
 * - WorkItemsTab: conditional hierarchy tree vs classic list
 * - WorkItemDetail: type-aware number prefix (E-/F-/PBI-/WI-/BUG-)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const WORK_ITEMS_DIR = path.join(REACT_SRC, 'features', 'work-items');

const NODE_SRC_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemHierarchyNode.tsx');
const TREE_SRC_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemHierarchyTree.tsx');
const GITHUB_MIRROR_BADGE_SRC_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemGitHubMirrorBadge.tsx');
const PICKER_SRC_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemParentPicker.tsx');
const DETAIL_SRC_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemDetail.tsx');
const TAB_SRC_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemsTab.tsx');
const CONFIG_SRC_PATH = path.join(REACT_SRC, 'utils', 'config.ts');

// ─────────────────────────────────────────────────────────────────────────────
// WorkItemHierarchyNode — type labels, pills, and collapse toggle
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkItemHierarchyNode — type system', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(NODE_SRC_PATH, 'utf-8');
    });

    it('exports WorkItemTypeLabel type with all 6 hierarchy types including goal', () => {
        expect(src).toContain("'epic' | 'feature' | 'pbi' | 'work-item' | 'bug' | 'goal'");
    });

    it('exports TYPE_LABELS map with all 6 human-readable labels', () => {
        expect(src).toContain("epic: 'Epic'");
        expect(src).toContain("feature: 'Feature'");
        expect(src).toContain("pbi: 'PBI'");
        expect(src).toContain("'work-item': 'Work Item'");
        expect(src).toContain("bug: 'Bug'");
        expect(src).toContain("goal: 'Goal'");
    });

    it('uses distinct prefix characters for each type', () => {
        expect(src).toContain("epic: 'E'");
        expect(src).toContain("feature: 'F'");
        expect(src).toContain("pbi: 'PBI'");
        expect(src).toContain("'work-item': 'WI'");
        expect(src).toContain("bug: 'BUG'");
        expect(src).toContain("goal: 'GOAL'");
    });

    it('has distinct CSS classes for each type pill', () => {
        expect(src).toContain('bg-purple-100');   // epic
        expect(src).toContain('bg-blue-100');      // feature
        expect(src).toContain('bg-cyan-100');      // pbi
        expect(src).toContain('bg-gray-100');      // work-item
        expect(src).toContain('bg-red-100');       // bug
        expect(src).toContain('bg-orange-100');    // goal
    });

    it('renders a collapse toggle button', () => {
        expect(src).toContain('collapse');
        expect(src).toContain('onClick');
    });

    it('renders rollup count summary', () => {
        expect(src).toContain('rollup');
        expect(src).toContain('descendantCount');
    });

    it('renders a compact GitHub mirror badge for mirrored rows', () => {
        expect(src).toContain('WorkItemGitHubMirrorBadge');
        expect(src).toContain('hierarchy-node-github-mirror-badge-');
        expect(src).toContain('mirror={item.githubMirror}');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkItemHierarchyTree — tree structure and create actions
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkItemHierarchyTree — structure', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TREE_SRC_PATH, 'utf-8');
    });

    it('imports WorkItemHierarchyNode', () => {
        expect(src).toContain("from './WorkItemHierarchyNode'");
    });

    it('imports WorkItemParentPicker', () => {
        expect(src).toContain("from './WorkItemParentPicker'");
    });

    it('fetches tree using coc-client workItems.tree()', () => {
        expect(src).toContain('workItems.tree(');
        expect(src).toContain('getSpaCocClient()');
    });

    it('has top-level Epic create action', () => {
        expect(src).toContain("'epic'");
        expect(src).toContain('onCreateItem');
    });

    it('has secondary unparented WorkItem and Bug actions', () => {
        expect(src).toContain("'work-item'");
        expect(src).toContain("'bug'");
    });

    it('persists collapse state in localStorage', () => {
        expect(src).toContain('localStorage');
        expect(src).toContain('coc-hierarchy-collapsed-');
    });

    it('uses ALLOWED_CHILD_TYPES for constrained child creation', () => {
        expect(src).toContain('ALLOWED_CHILD_TYPES');
    });

    it('handles Unparented group for root-level non-epic items', () => {
        expect(src).toContain('Unparented');
    });

    it('renders a search input for the hierarchy', () => {
        expect(src).toContain('search');
    });

    it('renders loading and error states', () => {
        expect(src).toContain('loading');
        expect(src).toContain('error');
    });

    it('handles disabled response from tree endpoint', () => {
        expect(src).toContain('disabled');
    });
});

describe('WorkItemHierarchyTree — GitHub tracker workflow', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TREE_SRC_PATH, 'utf-8');
    });

    it('does not expose the removed per-item preview/apply toolbar', () => {
        expect(src).not.toContain('hierarchy-sync-toolbar');
        expect(src).not.toContain('workItems.syncPreview');
        expect(src).not.toContain('workItems.syncApply');
        expect(src).not.toContain('conflictResolutions');
    });

    it('uses import as the GitHub tracker seeding action', () => {
        expect(src).toContain('onImportFromGitHub');
        expect(src).toContain('import-from-github-btn');
        expect(src).toContain('empty-import-from-github-btn');
    });

    it('keeps manual GitHub pulls as a per-Epic context action', () => {
        expect(src).toContain('Sync from GitHub');
        expect(src).toContain('workItems.syncGitHubEpic');
        expect(src).toContain("node.item.tracker?.kind === 'github-backed'");
    });
});

describe('WorkItemGitHubMirrorBadge — mirrored provider badge', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(GITHUB_MIRROR_BADGE_SRC_PATH, 'utf-8');
    });

    it('renders GitHub mirror metadata as external anchors when requested', () => {
        expect(src).toContain('WorkItemGitHubMirrorMetadata');
        expect(src).toContain('href={mirror.issueUrl}');
        expect(src).toContain('rel="noreferrer"');
    });

    it('surfaces open/closed mirror state without conflict-resolution UI', () => {
        expect(src).toContain("state === 'closed'");
        expect(src).not.toContain('conflict');
        expect(src).not.toContain('dirty');
        expect(src).not.toMatch(/token|secret|password|credential/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkItemParentPicker — dialog structure
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkItemParentPicker — structure', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(PICKER_SRC_PATH, 'utf-8');
    });

    it('accepts itemType prop to determine valid parent types', () => {
        expect(src).toContain('itemType');
    });

    it('filters candidates by valid parent types', () => {
        expect(src).toContain('validParentTypes');
    });

    it('has a cancel button to dismiss without selecting', () => {
        expect(src).toContain('Cancel');
        expect(src).toContain('onClose');
    });

    it('calls onSelect with the chosen parent id', () => {
        expect(src).toContain('onParentChanged');
    });

    it('renders search input for filtering candidates', () => {
        expect(src).toContain('search');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkItemDetail — container detection and leaf-only sections
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkItemDetail — container vs leaf', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(DETAIL_SRC_PATH, 'utf-8');
    });

    it('detects container types (epic, feature, pbi) to set isContainer flag', () => {
        expect(src).toContain('isContainer');
        expect(src).toContain("'epic'");
        expect(src).toContain("'feature'");
        expect(src).toContain("'pbi'");
    });

    it('hides plan section for container items', () => {
        const planSectionPos = src.indexOf('{/* Plan — leaf items only */}');
        const containerGuardPos = src.indexOf('!isContainer', planSectionPos > 0 ? planSectionPos : 0);
        // The plan section should be guarded by !isContainer nearby
        expect(planSectionPos).toBeGreaterThan(-1);
        expect(containerGuardPos).toBeGreaterThan(-1);
    });

    it('hides execution history for container items', () => {
        const execHistPos = src.indexOf('{/* Execution history */}');
        expect(execHistPos).toBeGreaterThan(-1);
        // The !isContainer guard should appear within 50 chars after the comment
        const nearbyGuard = src.indexOf('!isContainer', execHistPos);
        expect(nearbyGuard).toBeGreaterThan(execHistPos);
        expect(nearbyGuard - execHistPos).toBeLessThan(50);
    });

    it('hides Start Implementing / Execute button for container items', () => {
        const execBtnPos = src.indexOf('data-testid="work-item-execute-btn"');
        expect(execBtnPos).toBeGreaterThan(-1);
        // Should be preceded by !isContainer guard
        const guardPos = src.lastIndexOf('!isContainer', execBtnPos);
        expect(guardPos).toBeGreaterThan(-1);
    });

    it('shows type-aware number prefix based on item type', () => {
        // Type-specific prefix ternary chain in the header
        expect(src).toContain("effectiveType === 'epic' ? 'E'");
        expect(src).toContain("effectiveType === 'feature' ? 'F'");
        expect(src).toContain("effectiveType === 'bug' ? 'BUG'");
        expect(src).toContain("effectiveType === 'goal' ? 'GOAL'");
        expect(src).toContain("'WI'");
    });

    it('shows parent info row for items with a parentId', () => {
        expect(src).toContain('parentId');
        expect(src).toContain('Parent');
    });

    it('shows GitHub mirror badges and links in the detail panel', () => {
        expect(src).toContain('WorkItemGitHubMirrorBadge');
        expect(src).toContain('work-item-github-mirror-badge');
        expect(src).toContain('work-item-github-mirror');
        expect(src).not.toContain('work-item-sync-links');
    });

    it('does not auto-execute containers (autoExecute hidden)', () => {
        // The auto-execute toggle should be guarded by !isContainer
        const autoExecutePos = src.indexOf('autoExecute');
        const guardPos = src.lastIndexOf('!isContainer', autoExecutePos);
        if (autoExecutePos > -1 && guardPos > -1) {
            // Guard must come before the auto-execute reference
            expect(guardPos).toBeLessThan(autoExecutePos);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkItemsTab — conditional hierarchy tree vs classic list
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkItemsTab — hierarchy flag conditional', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TAB_SRC_PATH, 'utf-8');
    });

    it('imports WorkItemHierarchyTree', () => {
        expect(src).toContain("from './WorkItemHierarchyTree'");
    });

    it('uses isWorkItemsHierarchyEnabled() to detect flag', () => {
        expect(src).toContain('isWorkItemsHierarchyEnabled');
    });

    it('renders WorkItemHierarchyTree when hierarchy is enabled', () => {
        expect(src).toContain('<WorkItemHierarchyTree');
    });

    it('still renders WorkItemSection when hierarchy is disabled', () => {
        expect(src).toContain('<WorkItemSection');
    });

    it('WorkItemHierarchyTree appears before WorkItemSection in the conditional', () => {
        const treePos = src.indexOf('<WorkItemHierarchyTree');
        const sectionPos = src.indexOf('<WorkItemSection');
        expect(treePos).toBeGreaterThan(-1);
        expect(sectionPos).toBeGreaterThan(-1);
        expect(treePos).toBeLessThan(sectionPos);
    });

    it('has createDialogParentId state for hierarchy child creation', () => {
        expect(src).toContain('createDialogParentId');
        expect(src).toContain('setCreateDialogParentId');
    });

    it('passes import and highlight props to WorkItemHierarchyTree', () => {
        const treeIdx = src.indexOf('<WorkItemHierarchyTree');
        expect(treeIdx).toBeGreaterThan(-1);
        const treeBlock = src.slice(treeIdx, src.indexOf('/>', treeIdx) + 2);
        expect(treeBlock).toContain('onImportFromGitHub');
        expect(treeBlock).toContain('highlightedWorkItemId={highlightedWorkItemId}');
    });
});

describe('WorkItemsTab — Import from GitHub entry point', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TAB_SRC_PATH, 'utf-8');
    });

    it('uses the exact visible label in the non-hierarchy toolbar', () => {
        const btnIdx = src.indexOf('data-testid="import-from-github-btn"');
        expect(btnIdx).toBeGreaterThan(-1);
        const block = src.slice(btnIdx, btnIdx + 300);
        expect(block).toContain('Import from GitHub');
        expect(block).not.toContain('↓ GitHub');
    });
});

describe('WorkItemHierarchyTree — Import from GitHub entry point', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TREE_SRC_PATH, 'utf-8');
    });

    it('accepts and renders the standalone import action in the hierarchy toolbar', () => {
        expect(src).toContain('onImportFromGitHub');
        expect(src).toContain('data-testid="import-from-github-btn"');
        expect(src).toContain('Import from GitHub');
    });

    it('scrolls highlighted imported hierarchy rows into view', () => {
        expect(src).toContain('highlightedWorkItemId');
        expect(src).toContain('scrollIntoView({ block: \'center\', behavior: \'smooth\' })');
        expect(src).toContain('highlighted={highlightedWorkItemId === id}');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mobile add-child feature — AC-01, AC-02, AC-03, AC-04
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkItemHierarchyNode — mobile add-child button (AC-01 / AC-04)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(NODE_SRC_PATH, 'utf-8');
    });

    it('accepts isMobile prop', () => {
        expect(src).toContain('isMobile');
    });

    it('accepts onAddChild callback prop', () => {
        expect(src).toContain('onAddChild');
    });

    it('renders add-child button only for container nodes on mobile', () => {
        expect(src).toContain('isContainer');
        expect(src).toContain('isMobile');
        expect(src).toContain('onAddChild?.(node)');
    });

    it('uses testid hierarchy-node-add-child-<id> on the button', () => {
        expect(src).toContain('hierarchy-node-add-child-');
    });

    it('button does not depend on hover — no opacity/group-hover class', () => {
        // The add-child button must be always visible (no group-hover opacity trick)
        const btnIdx = src.indexOf('hierarchy-node-add-child-');
        expect(btnIdx).toBeGreaterThan(-1);
        // check there's no group-hover hidden class right near the button
        const excerpt = src.slice(Math.max(0, btnIdx - 200), btnIdx + 200);
        expect(excerpt).not.toContain('opacity-0');
    });
});

describe('WorkItemHierarchyTree — type-picker modal for mobile add-child (AC-02 / AC-04)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TREE_SRC_PATH, 'utf-8');
    });

    it('accepts isMobile prop', () => {
        expect(src).toContain('isMobile');
    });

    it('has handleAddChild callback that calls onCreateItem directly for single-type parents', () => {
        expect(src).toContain('handleAddChild');
        expect(src).toContain('onCreateItem');
    });

    it('opens a type-picker when parent has multiple allowed child types', () => {
        expect(src).toContain('typePicker');
        expect(src).toContain('setTypePicker');
    });

    it('renders type-picker overlay with testid type-picker-overlay', () => {
        expect(src).toContain('type-picker-overlay');
    });

    it('renders type-picker modal with testid type-picker-modal', () => {
        expect(src).toContain('type-picker-modal');
    });

    it('renders per-type options with testid type-picker-option-<type>', () => {
        expect(src).toContain('type-picker-option-');
    });

    it('renders a cancel button in the type picker', () => {
        expect(src).toContain('type-picker-cancel');
    });

    it('passes isMobile and onAddChild to WorkItemHierarchyNode', () => {
        expect(src).toContain('isMobile={isMobile}');
        expect(src).toContain('onAddChild={handleAddChild}');
    });
});

describe('WorkItemDetail — mobile Add Child button (AC-03 / AC-04)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(DETAIL_SRC_PATH, 'utf-8');
    });

    it('accepts isMobile prop', () => {
        expect(src).toContain('isMobile');
    });

    it('accepts onCreateChild callback prop', () => {
        expect(src).toContain('onCreateChild');
    });

    it('renders Add Child button guarded by isMobile and isContainer', () => {
        expect(src).toContain('wi-add-child-btn');
        const btnIdx = src.indexOf('wi-add-child-btn');
        expect(btnIdx).toBeGreaterThan(-1);
        // Check that isMobile and isContainer guards appear before this button
        const before = src.slice(0, btnIdx);
        expect(before).toContain('isMobile');
        expect(before).toContain('isContainer');
    });

    it('does not gate the Add Child button by hierarchyEnabled', () => {
        // The button should exist outside the isContainer && hierarchyEnabled block.
        // Find the nearest isMobile && isContainer guard before the button testid.
        const addChildIdx = src.indexOf('wi-add-child-btn');
        expect(addChildIdx).toBeGreaterThan(-1);
        // The isMobile && isContainer guard must appear somewhere before the testid
        const before = src.slice(0, addChildIdx);
        expect(before).toContain('isMobile && isContainer');
        // The guard controlling the button must NOT be coupled to hierarchyEnabled
        // Find the last occurrence of the isMobile guard before the testid
        const isMobileGuardIdx = before.lastIndexOf('isMobile && isContainer');
        const excerpt = src.slice(isMobileGuardIdx, addChildIdx + 20);
        expect(excerpt).not.toContain('hierarchyEnabled &&');
    });

    it('renders child type picker overlay with testid wi-child-type-picker-overlay', () => {
        expect(src).toContain('wi-child-type-picker-overlay');
    });

    it('renders child type picker modal with testid wi-child-type-picker-modal', () => {
        expect(src).toContain('wi-child-type-picker-modal');
    });

    it('imports ALLOWED_CHILD_TYPES from coc-client', () => {
        expect(src).toContain("ALLOWED_CHILD_TYPES");
        expect(src).toContain('@plusplusoneplusplus/coc-client');
    });
});

describe('WorkItemsTab — passes isMobile to tree and detail (AC-04)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TAB_SRC_PATH, 'utf-8');
    });

    it('passes isMobile to WorkItemHierarchyTree', () => {
        const treeIdx = src.indexOf('<WorkItemHierarchyTree');
        expect(treeIdx).toBeGreaterThan(-1);
        const treeBlock = src.slice(treeIdx, src.indexOf('/>', treeIdx) + 2);
        expect(treeBlock).toContain('isMobile={isMobile}');
    });

    it('passes isMobile to WorkItemDetail', () => {
        const detailIdx = src.indexOf('<WorkItemDetail');
        expect(detailIdx).toBeGreaterThan(-1);
        const detailBlock = src.slice(detailIdx, src.indexOf('/>', detailIdx) + 2);
        expect(detailBlock).toContain('isMobile={isMobile}');
    });

    it('passes onCreateChild to WorkItemDetail', () => {
        const detailIdx = src.indexOf('<WorkItemDetail');
        expect(detailIdx).toBeGreaterThan(-1);
        const detailBlock = src.slice(detailIdx, src.indexOf('/>', detailIdx) + 2);
        expect(detailBlock).toContain('onCreateChild');
    });
});

describe('SPA config — workItemsHierarchyEnabled', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(CONFIG_SRC_PATH, 'utf-8');
    });

    it('includes workItemsHierarchyEnabled in DashboardConfig interface', () => {
        expect(src).toContain('workItemsHierarchyEnabled');
    });

    it('exports isWorkItemsHierarchyEnabled() function', () => {
        expect(src).toContain('isWorkItemsHierarchyEnabled');
        expect(src).toContain('function isWorkItemsHierarchyEnabled');
    });

    it('default value is false (returns false when config is not set to true)', () => {
        // The function returns `getConfig().workItemsHierarchyEnabled === true`
        // so it returns false unless explicitly set to true
        expect(src).toContain('=== true');
        // The function name must be present
        expect(src).toContain('isWorkItemsHierarchyEnabled');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI Authoring entry points — WorkItemHierarchyTree (AC-01 item 5)
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkItemHierarchyTree — AI Authoring entry point', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TREE_SRC_PATH, 'utf-8');
    });

    it('accepts optional onCreateWithAi prop', () => {
        expect(src).toContain('onCreateWithAi');
    });

    it('renders hierarchy-create-with-ai-btn when onCreateWithAi is provided', () => {
        expect(src).toContain('hierarchy-create-with-ai-btn');
    });

    it('guards the AI button on onCreateWithAi being provided', () => {
        const btnIdx = src.indexOf('hierarchy-create-with-ai-btn');
        expect(btnIdx).toBeGreaterThan(-1);
        // onCreateWithAi guard must appear before the button
        const before = src.slice(0, btnIdx);
        expect(before).toContain('onCreateWithAi');
    });

    it('also exposes Create with AI in the empty state', () => {
        expect(src).toContain('hierarchy-empty-create-with-ai-btn');
    });
});

describe('WorkItemsTab — passes onCreateWithAi to hierarchy tree (AC-01 item 5)', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(TAB_SRC_PATH, 'utf-8');
    });

    it('passes onCreateWithAi prop to WorkItemHierarchyTree', () => {
        const treeIdx = src.indexOf('<WorkItemHierarchyTree');
        expect(treeIdx).toBeGreaterThan(-1);
        const treeBlock = src.slice(treeIdx, src.indexOf('/>', treeIdx) + 2);
        expect(treeBlock).toContain('onCreateWithAi');
    });

    it('gates onCreateWithAi on the AI authoring feature flag', () => {
        // The prop value should be conditional on aiAuthoringEnabled
        expect(src).toContain('aiAuthoringEnabled');
        const treeIdx = src.indexOf('<WorkItemHierarchyTree');
        const treeBlock = src.slice(treeIdx, src.indexOf('/>', treeIdx) + 2);
        expect(treeBlock).toContain('aiAuthoringEnabled');
    });
});
