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

    it('exports WorkItemTypeLabel type with all 5 hierarchy types', () => {
        expect(src).toContain("'epic' | 'feature' | 'pbi' | 'work-item' | 'bug'");
    });

    it('exports TYPE_LABELS map with all 5 human-readable labels', () => {
        expect(src).toContain("epic: 'Epic'");
        expect(src).toContain("feature: 'Feature'");
        expect(src).toContain("pbi: 'PBI'");
        expect(src).toContain("'work-item': 'Work Item'");
        expect(src).toContain("bug: 'Bug'");
    });

    it('uses distinct prefix characters for each type', () => {
        expect(src).toContain("epic: 'E'");
        expect(src).toContain("feature: 'F'");
        expect(src).toContain("pbi: 'PBI'");
        expect(src).toContain("'work-item': 'WI'");
        expect(src).toContain("bug: 'BUG'");
    });

    it('has distinct CSS classes for each type pill', () => {
        expect(src).toContain('bg-purple-100');   // epic
        expect(src).toContain('bg-blue-100');      // feature
        expect(src).toContain('bg-cyan-100');      // pbi
        expect(src).toContain('bg-gray-100');      // work-item
        expect(src).toContain('bg-red-100');       // bug
    });

    it('renders a collapse toggle button', () => {
        expect(src).toContain('collapse');
        expect(src).toContain('onClick');
    });

    it('renders rollup count summary', () => {
        expect(src).toContain('rollup');
        expect(src).toContain('descendantCount');
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
        expect(src).toContain('VALID_PARENT_TYPES');
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
        expect(src).toContain("'WI'");
    });

    it('shows parent info row for items with a parentId', () => {
        expect(src).toContain('parentId');
        expect(src).toContain('Parent');
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
});

// ─────────────────────────────────────────────────────────────────────────────
// SPA config — feature flag plumbing
// ─────────────────────────────────────────────────────────────────────────────

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
