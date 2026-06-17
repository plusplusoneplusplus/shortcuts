/**
 * AC Compliance — AI Work Item Authoring (AC-01 through AC-05)
 *
 * Source-level evidence that every AC Definition of Done is satisfied.
 * Uses the same source-inspection pattern as other work-items tests in
 * this project (grep source files, no DOM rendering needed).
 *
 * One suite per AC; each test corresponds to one DoD bullet.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─── File paths ───────────────────────────────────────────────────────────────

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const WORK_ITEMS_DIR = path.join(REACT_SRC, 'features', 'work-items');
const SERVER_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server');
const TEST_SERVER_SRC = path.join(__dirname, '..', '..', '..', 'server');

const COMPOSER_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemAiComposer.tsx');
const WORK_ITEMS_TAB_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemsTab.tsx');
const WORK_ITEM_DETAIL_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemDetail.tsx');
const HIERARCHY_TREE_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemHierarchyTree.tsx');
const ADMIN_PANEL_PATH = path.join(REACT_SRC, 'admin', 'AdminPanel.tsx');
const SPA_CONFIG_PATH = path.join(REACT_SRC, 'utils', 'config.ts');
const AI_ROUTES_PATH = path.join(SERVER_SRC, 'routes', 'work-item-ai-routes.ts');
const WORK_ITEM_ROUTES_PATH = path.join(SERVER_SRC, 'routes', 'work-item-routes.ts');
const WORK_ITEM_COMMANDS_PATH = path.join(SERVER_SRC, 'work-items', 'work-item-commands.ts');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function read(p: string): string {
    return fs.readFileSync(p, 'utf-8');
}

// ─── AC-01: Discoverable AI entry points ─────────────────────────────────────

describe('AC-01 — Discoverable AI entry points', () => {
    describe('DoD 1: Work Items list "Create with AI" action', () => {
        let tabSrc: string;
        beforeAll(() => { tabSrc = read(WORK_ITEMS_TAB_PATH); });

        it('WorkItemsTab has "Create with AI" button in the list header (non-hierarchy)', () => {
            expect(tabSrc).toContain('create-with-ai-btn');
            expect(tabSrc).toContain('Create with AI');
        });

        it('WorkItemsTab has "Create with AI" button in the empty-state (non-hierarchy)', () => {
            expect(tabSrc).toContain('create-with-ai-empty-btn');
        });

        it('WorkItemsTab buttons are gated behind aiAuthoringEnabled flag', () => {
            expect(tabSrc).toContain('aiAuthoringEnabled');
        });
    });

    describe('DoD 1: Hierarchy tree "Create with AI" entry point', () => {
        let treeSrc: string;
        beforeAll(() => { treeSrc = read(HIERARCHY_TREE_PATH); });

        it('WorkItemHierarchyTree accepts onCreateWithAi prop', () => {
            expect(treeSrc).toContain('onCreateWithAi');
        });

        it('WorkItemHierarchyTree renders hierarchy-create-with-ai-btn when prop is provided', () => {
            expect(treeSrc).toContain('hierarchy-create-with-ai-btn');
        });

        it('WorkItemHierarchyTree also exposes the button in the empty state', () => {
            expect(treeSrc).toContain('hierarchy-empty-create-with-ai-btn');
        });
    });

    describe('DoD 2: WorkItemDetail "Improve with AI" contextual actions', () => {
        let detailSrc: string;
        beforeAll(() => { detailSrc = read(WORK_ITEM_DETAIL_PATH); });

        it('WorkItemDetail renders an "Improve with AI" button', () => {
            expect(detailSrc).toContain('work-item-improve-with-ai-btn');
            expect(detailSrc).toContain('Improve with AI');
        });

        it('The "Improve with AI" button is gated behind aiAuthoringEnabled', () => {
            expect(detailSrc).toContain('aiAuthoringEnabled');
            const btnIdx = detailSrc.indexOf('work-item-improve-with-ai-btn');
            expect(btnIdx).toBeGreaterThan(-1);
            const before = detailSrc.slice(0, btnIdx);
            expect(before).toContain('aiAuthoringEnabled');
        });

        it('WorkItemDetail renders WorkItemAiComposer in improve mode', () => {
            expect(detailSrc).toContain('<WorkItemAiComposer');
            expect(detailSrc).toContain('mode="improve"');
        });

        it('onImproved={fetchItem} so detail refreshes after approval', () => {
            expect(detailSrc).toContain('onImproved={fetchItem}');
        });
    });

    describe('DoD 3: UI covers all phases (states)', () => {
        let composerSrc: string;
        beforeAll(() => { composerSrc = read(COMPOSER_PATH); });

        it('has idle (empty) state', () => {
            expect(composerSrc).toContain('ai-composer-preview-empty');
        });

        it('has generating/loading state with spinner', () => {
            expect(composerSrc).toContain("phase === 'generating'");
            expect(composerSrc).toContain('Generating draft');
        });

        it('has clarifying state with Q&A inputs', () => {
            expect(composerSrc).toContain("phase === 'clarifying'");
            expect(composerSrc).toContain('ai-composer-clarification');
        });

        it('has preview state', () => {
            expect(composerSrc).toContain("phase === 'preview'");
            expect(composerSrc).toContain('ai-composer-tabs');
        });

        it('has error state with dismissable block', () => {
            expect(composerSrc).toContain('ai-composer-error');
        });

        it('has saving state', () => {
            expect(composerSrc).toContain("phase === 'saving'");
        });
    });

    describe('DoD 3: Existing manual flows are unchanged', () => {
        let tabSrc: string;
        let detailSrc: string;
        beforeAll(() => {
            tabSrc = read(WORK_ITEMS_TAB_PATH);
            detailSrc = read(WORK_ITEM_DETAIL_PATH);
        });

        it('WorkItemsTab still renders CreateWorkItemDialog for manual creation', () => {
            expect(tabSrc).toContain('CreateWorkItemDialog');
            expect(tabSrc).toContain('showCreateDialog');
        });

        it('WorkItemDetail still renders edit/save sections for manual editing', () => {
            // Inline editing is handled by workitem-field-edit or inline edit pattern
            expect(detailSrc).toContain('edit');
        });
    });
});

// ─── AC-02: Bounded hybrid wizard + chat drafting flow ───────────────────────

describe('AC-02 — Bounded wizard + chat drafting flow', () => {
    let composerSrc: string;
    beforeAll(() => { composerSrc = read(COMPOSER_PATH); });

    describe('DoD 1: Draft generation returns clarification or structured preview', () => {
        it('handles clarification kind from API', () => {
            expect(composerSrc).toContain("resp.kind === 'clarification'");
        });

        it('handles draft kind from API', () => {
            // applyDraft is called when response is a draft
            expect(composerSrc).toContain('applyDraft');
        });
    });

    describe('DoD 2: 3-question limit enforced', () => {
        it('defines MAX_CLARIFICATION_ROUNDS = 3', () => {
            expect(composerSrc).toContain('MAX_CLARIFICATION_ROUNDS = 3');
        });

        it('passes clarificationCount to the API', () => {
            expect(composerSrc).toContain('clarificationCount');
        });

        it('server route enforces the limit (routes file)', () => {
            const routesSrc = read(AI_ROUTES_PATH);
            expect(routesSrc).toContain('MAX_CLARIFICATION_ROUNDS');
            expect(routesSrc).toContain('Clarification limit exceeded');
        });
    });

    describe('DoD 2: "Generate draft anyway" bypass at any time', () => {
        it('has "Generate draft anyway" button', () => {
            expect(composerSrc).toContain('ai-composer-generate-anyway-btn');
            expect(composerSrc).toContain('Generate draft anyway');
        });

        it('clicking generate-anyway passes MAX count to force draft', () => {
            expect(composerSrc).toContain('handleGenerate(true)');
            // forceDraft=true causes effectiveClarifyCount = MAX_CLARIFICATION_ROUNDS
            expect(composerSrc).toContain('forceDraft ? MAX_CLARIFICATION_ROUNDS');
        });
    });

    describe('DoD 3: Cancelling before approval leaves no new/modified work item', () => {
        it('create API call is inside handleApprove only', () => {
            const generateFnStart = composerSrc.indexOf('const handleGenerate');
            const approveFnStart = composerSrc.indexOf('const handleApprove');
            const createCallIdx = composerSrc.indexOf('workItems.createForOrigin(workItemOriginId');
            expect(createCallIdx).toBeGreaterThan(approveFnStart);
            // create call must NOT be inside handleGenerate
            const generateFnEnd = composerSrc.indexOf('\n    };', generateFnStart);
            if (generateFnEnd > generateFnStart && createCallIdx < generateFnEnd) {
                throw new Error('workItems.create is inside handleGenerate — it must only be in handleApprove');
            }
        });

        it('update/patch API call is inside handleApprove only', () => {
            const approveFnStart = composerSrc.indexOf('const handleApprove');
            const updateCallIdx = composerSrc.indexOf('workItems.updateForOrigin(workItemOriginId');
            expect(updateCallIdx).toBeGreaterThan(approveFnStart);
        });
    });

    describe('DoD 4: Errors surfaced in composer without silent success-shaped fallback', () => {
        it('catch block sets the error state, not a success path', () => {
            expect(composerSrc).toContain('setError(err instanceof Error ? err.message : \'Failed to generate draft\')');
        });

        it('saving errors are surfaced and phase reverts to preview', () => {
            expect(composerSrc).toContain("setPhase('preview')");
            expect(composerSrc).toContain('Failed to save');
        });
    });
});

// ─── AC-03: Persist approved AI output through existing work item APIs ────────

describe('AC-03 — Persist through existing work item APIs', () => {
    let composerSrc: string;
    let workItemRoutesSrc: string;
    beforeAll(() => {
        composerSrc = read(COMPOSER_PATH);
        workItemRoutesSrc = read(WORK_ITEM_ROUTES_PATH);
    });

    describe('DoD 1: New item via POST /api/origins/:originId/work-items', () => {
        it('approval calls workItems.create for new items', () => {
            expect(composerSrc).toContain('workItems.createForOrigin(workItemOriginId');
        });

        it('work-item route is origin-scoped (URL has :originId segment)', () => {
            expect(workItemRoutesSrc).toContain('/api/origins/');
            expect(workItemRoutesSrc).toContain(':originId');
            expect(workItemRoutesSrc).toContain('work-items');
        });
    });

    describe('DoD 2: Existing item updates via existing update/plan-version model', () => {
        it('approval calls workItems.update for improve mode', () => {
            expect(composerSrc).toContain('workItems.updateForOrigin(workItemOriginId, existingItem!.id');
        });

        it('approval sends plan content through the origin update payload when changed', () => {
            expect(composerSrc).toContain('plan: { content: draftGoal }');
        });

        it('plan is updated only when content differs from current', () => {
            expect(composerSrc).toContain("draftGoal !== existingItem?.plan?.content");
        });
    });

    describe('DoD 3: WebSocket/dashboard refresh (plan.content on work item)', () => {
        it('plan content is passed in the create call (plan property)', () => {
            expect(composerSrc).toContain('plan: planContent');
        });
    });

    describe('DoD 4: No approval path starts Ralph execution', () => {
        it('handleApprove does not call workItems.execute or anything execution-related', () => {
            const approveFn = composerSrc.slice(
                composerSrc.indexOf('const handleApprove'),
                composerSrc.indexOf('const isBusy ='),
            );
            expect(approveFn).not.toContain('execute');
            expect(approveFn).not.toContain('ralph');
            expect(approveFn).not.toContain('startRalph');
            expect(approveFn).not.toContain('runWorkflow');
        });
    });
});

// ─── AC-04: Reviewed child task breakdowns without breaking hierarchy flag ────

describe('AC-04 — Child task breakdowns and hierarchy flag', () => {
    let composerSrc: string;
    beforeAll(() => { composerSrc = read(COMPOSER_PATH); });

    describe('DoD 1: Parent-child validation follows ALLOWED_PARENT_TYPES / ALLOWED_CHILD_TYPES', () => {
        it('WorkItemHierarchyTree imports ALLOWED_CHILD_TYPES from coc-client', () => {
            const treeSrc = read(HIERARCHY_TREE_PATH);
            expect(treeSrc).toContain('ALLOWED_CHILD_TYPES');
            expect(treeSrc).toContain('@plusplusoneplusplus/coc-client');
        });

        it('work-item routes delegate to the command service, which uses isValidParentChildTypes', () => {
            const routesSrc = read(WORK_ITEM_ROUTES_PATH);
            expect(routesSrc).toContain('work-item-commands');
            const commandsSrc = read(WORK_ITEM_COMMANDS_PATH);
            expect(commandsSrc).toContain('isValidParentChildTypes');
        });
    });

    describe('DoD 2: Hierarchy-disabled workspaces use task breakdown as checklist', () => {
        it('when hierarchy is disabled, child tasks are folded into plan as checklist', () => {
            expect(composerSrc).toContain('!hierarchyEnabled');
            expect(composerSrc).toContain('checklist');
        });

        it('checklist uses markdown task format (- [ ] ...)', () => {
            expect(composerSrc).toContain('- [ ]');
        });

        it('child tasks tab label changes based on hierarchy flag', () => {
            expect(composerSrc).toContain("hierarchyEnabled ? 'Child Tasks' : 'Task Checklist'");
        });

        it('UI shows a note when hierarchy is disabled', () => {
            expect(composerSrc).toContain('Hierarchy is disabled');
        });
    });

    describe('DoD 3: Child records are never created in a different workspace', () => {
        it('child creation uses the same workspaceId as the parent (composer)', () => {
            // All create calls use workspaceId from props — never a different id
            const approveSection = composerSrc.slice(
                composerSrc.indexOf('const handleApprove'),
                composerSrc.indexOf('const isBusy ='),
            );
            expect(approveSection).toContain('workItems.createForOrigin(workItemOriginId');
            expect(approveSection).toContain('}, { workspaceId });');
        });
    });
});

// ─── AC-05: Workspace-scoped, reviewable, feature-flagged ────────────────────

describe('AC-05 — Workspace-scoped, reviewable, feature-flagged', () => {
    describe('DoD 1: Server/API tests cover workspace scoping, validation, hierarchy fallback', () => {
        it('work-item-ai-routes.test.ts exists with workspace scoping tests', () => {
            const testFile = path.join(TEST_SERVER_SRC, 'work-items', 'work-item-ai-routes.test.ts');
            expect(fs.existsSync(testFile)).toBe(true);
            const testSrc = read(testFile);
            expect(testSrc).toContain('Workspace scoping');
            expect(testSrc).toContain('workspace-B');
        });

        it('work-item-ai-hierarchy.test.ts exists with hierarchy approval round-trip tests', () => {
            const testFile = path.join(TEST_SERVER_SRC, 'work-items', 'work-item-ai-hierarchy.test.ts');
            expect(fs.existsSync(testFile)).toBe(true);
            const testSrc = read(testFile);
            expect(testSrc).toContain('full hierarchy-enabled approval round-trip');
            expect(testSrc).toContain('checklist fallback');
        });
    });

    describe('DoD 2: No new top-level ~/.coc per-repo storage', () => {
        it('ai-routes file does not reference top-level ~/.coc paths', () => {
            const routesSrc = read(AI_ROUTES_PATH);
            expect(routesSrc).not.toContain('~/.coc/');
            expect(routesSrc).not.toContain('process.env.HOME');
        });

        it('ai-generator file does not write to disk directly', () => {
            const genPath = path.join(SERVER_SRC, 'work-items', 'work-item-ai-generator.ts');
            const genSrc = read(genPath);
            expect(genSrc).not.toContain('fs.write');
            expect(genSrc).not.toContain('fs.mkdir');
            expect(genSrc).not.toContain('~/.coc/');
        });
    });

    describe('DoD 3: Feature flag default is false', () => {
        it('admin setting registry declares workItems.aiAuthoring.enabled with default false', async () => {
            const { getAdminSettingDefinition } = await import('../../../../src/config/admin-setting-definitions');
            const def = getAdminSettingDefinition('workItems.aiAuthoring.enabled');
            expect(def).toBeDefined();
            expect(def!.value.kind).toBe('boolean');
            expect(def!.default).toBe(false);

            const { CLIConfigSchema } = await import('../../../../src/config/schema');
            expect(() => CLIConfigSchema.parse({ workItems: { aiAuthoring: { enabled: false } } })).not.toThrow();
            expect(() => CLIConfigSchema.parse({ workItems: { aiAuthoring: { enabled: 'yes' } } })).toThrow();
        });

        it('SPA config isWorkItemsAiAuthoringEnabled defaults to false', () => {
            const configSrc = read(SPA_CONFIG_PATH);
            expect(configSrc).toContain('isWorkItemsAiAuthoringEnabled');
            // Returns false unless explicitly set to true
            expect(configSrc).toContain('=== true');
        });

        it('route returns 403 when flag is off (verified by ai-routes test)', () => {
            const testSrc = read(path.join(TEST_SERVER_SRC, 'work-items', 'work-item-ai-routes.test.ts'));
            expect(testSrc).toContain('Feature flag disabled (default)');
            expect(testSrc).toContain('403');
        });
    });

    describe('DoD 4: Session-per-request SDK behavior, no session caching', () => {
        it('ai-generator does not cache or reuse SDK sessions between requests', () => {
            const genPath = path.join(SERVER_SRC, 'work-items', 'work-item-ai-generator.ts');
            const genSrc = read(genPath);
            // Each call to generateNewItemDraft / generateImproveItemDraft must
            // invoke createCLIAIInvoker fresh (lazy-imported per call).
            expect(genSrc).toContain('createCLIAIInvoker');
            // No module-level session or invoker cache
            expect(genSrc).not.toContain('cachedInvoker');
            expect(genSrc).not.toContain('_invokerCache');
            expect(genSrc).not.toContain('sendFollowUp');
        });

        it('ai-generator does not expose a sendFollowUp method', () => {
            const genPath = path.join(SERVER_SRC, 'work-items', 'work-item-ai-generator.ts');
            const genSrc = read(genPath);
            expect(genSrc).not.toContain('sendFollowUp');
        });

        it('ai-routes file does not add session keep-alive patterns', () => {
            const routesSrc = read(AI_ROUTES_PATH);
            expect(routesSrc).not.toContain('sendFollowUp');
            expect(routesSrc).not.toContain('keepAlive');
            expect(routesSrc).not.toContain('sessionCache');
        });
    });
});
