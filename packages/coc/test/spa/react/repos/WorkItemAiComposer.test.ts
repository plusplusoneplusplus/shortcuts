/**
 * Tests for WorkItemAiComposer — AI-assisted work item authoring modal.
 *
 * Uses source-code inspection (same pattern as other work-items tests).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REACT_SRC = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const WORK_ITEMS_DIR = path.join(REACT_SRC, 'features', 'work-items');
const COMPOSER_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemAiComposer.tsx');
const WORK_ITEMS_TAB_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemsTab.tsx');
const WORK_ITEM_DETAIL_PATH = path.join(WORK_ITEMS_DIR, 'WorkItemDetail.tsx');
const INDEX_PATH = path.join(WORK_ITEMS_DIR, 'index.ts');

describe('WorkItemAiComposer', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(COMPOSER_PATH, 'utf-8');
    });

    describe('props interface', () => {
        it('has the required props: open, onClose, workspaceId, mode', () => {
            expect(src).toContain('open: boolean');
            expect(src).toContain('onClose: () => void');
            expect(src).toContain('workspaceId: string');
            expect(src).toContain("mode: 'create' | 'improve'");
        });

        it('has existingItem, parentId, itemType, onCreated, onImproved props', () => {
            expect(src).toContain('existingItem?:');
            expect(src).toContain('parentId?:');
            expect(src).toContain('itemType?:');
            expect(src).toContain('onCreated?:');
            expect(src).toContain('onImproved?:');
        });
    });

    describe('states', () => {
        it('has idle state with empty preview', () => {
            expect(src).toContain('ai-composer-preview-empty');
        });

        it('has generating/loading state with spinner', () => {
            expect(src).toContain('generating');
            expect(src).toContain('Generating draft');
        });

        it('has clarifying state with Q&A inputs', () => {
            expect(src).toContain('clarifying');
            expect(src).toContain('ai-composer-clarification');
            expect(src).toContain('ai-composer-clarify-answer-');
        });

        it('has preview state with editable tabs', () => {
            expect(src).toContain('preview');
            expect(src).toContain('ai-composer-tabs');
            expect(src).toContain('ai-composer-work-item-tab');
        });

        it('has error state with dismissable error block', () => {
            expect(src).toContain('ai-composer-error');
        });

        it('has saving state', () => {
            expect(src).toContain('saving');
            expect(src).toContain('Saving');
        });
    });

    describe('feature: clarification limit', () => {
        it('defines MAX_CLARIFICATION_ROUNDS = 3', () => {
            expect(src).toContain('MAX_CLARIFICATION_ROUNDS = 3');
        });

        it('has a "Generate draft anyway" button', () => {
            expect(src).toContain('ai-composer-generate-anyway-btn');
            expect(src).toContain('Generate draft anyway');
        });

        it('passes clarificationCount to the API', () => {
            expect(src).toContain('clarificationCount');
        });
    });

    describe('review-before-save', () => {
        it('does not call create API until handleApprove is invoked', () => {
            // The create call must be inside handleApprove, not in handleGenerate
            const generateFnStart = src.indexOf('const handleGenerate');
            const approveFnStart = src.indexOf('const handleApprove');
            const createCallIdx = src.indexOf("workItems.create(workspaceId");
            expect(generateFnStart).toBeGreaterThan(-1);
            expect(approveFnStart).toBeGreaterThan(-1);
            expect(createCallIdx).toBeGreaterThan(-1);
            // The create call should be inside handleApprove, not in handleGenerate
            expect(createCallIdx).toBeGreaterThan(approveFnStart);
        });

        it('has an Approve & Create button that calls handleApprove', () => {
            expect(src).toContain('ai-composer-approve-btn');
            expect(src).toContain('Approve & Create');
        });

        it('has an Approve & Update label for improve mode', () => {
            expect(src).toContain('Approve & Update');
        });
    });

    describe('approval flow: create mode', () => {
        it('calls workItems.create with AI-generated fields', () => {
            expect(src).toContain('workItems.create(workspaceId');
        });

        it('passes plan content to the create call', () => {
            expect(src).toContain('plan: planContent');
        });

        it('creates child items when hierarchy is enabled', () => {
            expect(src).toContain('hierarchyEnabled && draftChildTasks.length > 0');
        });

        it('folds child tasks into plan checklist when hierarchy is disabled', () => {
            expect(src).toContain('!hierarchyEnabled');
            expect(src).toContain('checklist');
        });
    });

    describe('approval flow: improve mode', () => {
        it('calls workItems.update for the existing item', () => {
            expect(src).toContain('workItems.update(workspaceId, existingItem!.id');
        });

        it('calls workItems.updatePlan when goal/plan content changed', () => {
            expect(src).toContain('workItems.updatePlan(workspaceId, existingItem!.id');
        });

        it('only updates plan when content differs from current', () => {
            expect(src).toContain("draftGoal !== existingItem?.plan?.content");
        });
    });

    describe('UI layout', () => {
        it('has a wide dialog with max-w-[900px]', () => {
            expect(src).toContain('max-w-[900px]');
        });

        it('has a two-column layout (left prompt + right preview)', () => {
            expect(src).toContain('ai-composer-left');
            expect(src).toContain('ai-composer-right');
        });

        it('has the prompt textarea', () => {
            expect(src).toContain('ai-composer-prompt');
        });

        it('has Work Item tab', () => {
            expect(src).toContain('ai-composer-tab-work-item');
        });

        it('has Goal tab', () => {
            expect(src).toContain('ai-composer-tab-goal');
        });

        it('has Child Tasks tab', () => {
            expect(src).toContain('ai-composer-tab-child-tasks');
        });

        it('shows hierarchy note when hierarchy is disabled', () => {
            expect(src).toContain('Hierarchy is disabled');
        });
    });

    describe('calls the correct API methods', () => {
        it('calls workItems.aiDraft for create mode', () => {
            expect(src).toContain('workItems.aiDraft(workspaceId');
        });

        it('calls workItems.aiImprove for improve mode', () => {
            expect(src).toContain('workItems.aiImprove(workspaceId');
        });
    });

    describe('resets state on open', () => {
        it('resets all state fields when the dialog opens', () => {
            expect(src).toContain("setPhase('idle')");
            expect(src).toContain('setPrompt(\'\')');
            expect(src).toContain('setClarifyQuestions([])');
            expect(src).toContain('setDraftGoal(\'\')');
        });
    });
});

describe('WorkItemsTab — Create with AI entry point', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(WORK_ITEMS_TAB_PATH, 'utf-8');
    });

    it('imports WorkItemAiComposer', () => {
        expect(src).toContain("WorkItemAiComposer");
    });

    it('imports isWorkItemsAiAuthoringEnabled from config', () => {
        expect(src).toContain('isWorkItemsAiAuthoringEnabled');
    });

    it('renders "Create with AI" button gated behind feature flag', () => {
        expect(src).toContain('create-with-ai-btn');
        expect(src).toContain('aiAuthoringEnabled');
    });

    it('renders the AI composer modal', () => {
        expect(src).toContain('<WorkItemAiComposer');
        expect(src).toContain("mode=\"create\"");
    });

    it('passes workspaceId and onCreated to the composer', () => {
        expect(src).toContain('workspaceId={workspaceId}');
        expect(src).toContain('onCreated={handleCreated}');
    });
});

describe('WorkItemDetail — Improve with AI entry point', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(WORK_ITEM_DETAIL_PATH, 'utf-8');
    });

    it('imports WorkItemAiComposer', () => {
        expect(src).toContain('WorkItemAiComposer');
    });

    it('renders "Improve with AI" button gated behind feature flag', () => {
        expect(src).toContain('work-item-improve-with-ai-btn');
        expect(src).toContain('aiAuthoringEnabled');
    });

    it('renders the composer in improve mode', () => {
        expect(src).toContain('<WorkItemAiComposer');
        expect(src).toContain("mode=\"improve\"");
    });

    it('passes existingItem with id, title, description, type, plan', () => {
        expect(src).toContain('existingItem={{');
        expect(src).toContain('id: item.id');
        expect(src).toContain('title: item.title');
    });

    it('passes onImproved={fetchItem} so detail refreshes on approval', () => {
        expect(src).toContain('onImproved={fetchItem}');
    });
});

describe('work-items/index.ts — exports', () => {
    let src: string;

    beforeAll(() => {
        src = fs.readFileSync(INDEX_PATH, 'utf-8');
    });

    it('exports WorkItemAiComposer', () => {
        expect(src).toContain('WorkItemAiComposer');
    });
});
