/**
 * Tests for SkillContextDialog component source structure.
 *
 * Validates component exports, props interface, state management,
 * dialog rendering, textarea for user context, and button behavior.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const COMPONENT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'SkillContextDialog.tsx'
);

let source: string;

beforeAll(() => {
    source = fs.readFileSync(COMPONENT_PATH, 'utf-8');
});

describe('SkillContextDialog', () => {
    it('exports SkillContextDialog function component', () => {
        expect(source).toContain('export function SkillContextDialog');
    });

    it('exports SkillContextDialogProps interface', () => {
        expect(source).toContain('export interface SkillContextDialogProps');
    });

    describe('props interface', () => {
        it('has open boolean prop', () => {
            expect(source).toContain('open: boolean');
        });

        it('has optional workspaceId prop for repo-scoped AI defaults', () => {
            expect(source).toContain('workspaceId?: string');
        });

        it('has skillName string prop', () => {
            expect(source).toContain('skillName: string');
        });

        it('has targetSummary string prop', () => {
            expect(source).toContain('targetSummary: string');
        });

        it('has onClose callback prop', () => {
            expect(source).toContain('onClose: () => void');
        });

        it('has onConfirm callback prop that takes userContext and AI selection', () => {
            expect(source).toContain('onConfirm: (userContext: string, aiSelection: ResolvedModalJobAiSelection) => Promise<void>');
        });
    });

    describe('state management', () => {
        it('tracks userContext state', () => {
            expect(source).toContain('const [userContext, setUserContext]');
        });

        it('tracks loading state', () => {
            expect(source).toContain('const [loading, setLoading]');
        });

        it('tracks error state', () => {
            expect(source).toContain('const [error, setError]');
        });

        it('resets state when dialog opens', () => {
            expect(source).toContain("if (open) {");
            expect(source).toContain("setUserContext('')");
            expect(source).toContain('setLoading(false)');
            expect(source).toContain('setError(null)');
        });
    });

    describe('dialog rendering', () => {
        it('renders skill name in dialog title', () => {
            expect(source).toContain('`Run Skill: ${skillName}`');
        });

        it('displays target summary', () => {
            expect(source).toContain('{targetSummary}');
        });

        it('renders a textarea for user context', () => {
            expect(source).toContain('<textarea');
            expect(source).toContain('value={userContext}');
        });

        it('renders compact modal AI controls', () => {
            expect(source).toContain('<ModalJobAiControls');
            expect(source).toContain('testIdPrefix="skill-context"');
        });

        it('textarea has placeholder text', () => {
            expect(source).toContain('Add instructions or context for the skill (optional)');
        });

        it('textarea is disabled during loading', () => {
            expect(source).toContain('disabled={loading}');
        });
    });

    describe('buttons', () => {
        it('renders Cancel button', () => {
            expect(source).toContain('Cancel');
        });

        it('renders Run button', () => {
            expect(source).toContain("'Run'");
        });

        it('Run button shows loading text when submitting', () => {
            expect(source).toContain("'Running…'");
        });

        it('Cancel button calls onClose', () => {
            expect(source).toContain('onClick={onClose}');
        });

        it('Run button calls handleConfirm', () => {
            expect(source).toContain('onClick={handleConfirm}');
        });

        it('both buttons are disabled during loading', () => {
            const buttonMatches = source.match(/disabled={loading}/g);
            expect(buttonMatches).toBeTruthy();
            expect(buttonMatches!.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe('keyboard shortcut', () => {
        it('supports Ctrl/Cmd+Enter to submit', () => {
            expect(source).toContain('e.ctrlKey || e.metaKey');
            expect(source).toContain("e.key === 'Enter'");
        });
    });

    describe('error handling', () => {
        it('shows error message when present', () => {
            expect(source).toContain('{error && (');
            expect(source).toContain('text-red-600');
        });

        it('sets error on failure', () => {
            expect(source).toContain("'Failed to enqueue skill'");
        });

        it('wraps onConfirm in try-catch', () => {
            expect(source).toContain('await onConfirm(userContext.trim(), aiSelection.resolved)');
        });
    });

    describe('follows SummarizeChatDialog pattern', () => {
        it('imports Dialog from ui', () => {
            expect(source).toContain("import { Dialog } from '../../ui/Dialog'");
        });

        it('imports Button from ui', () => {
            expect(source).toContain("import { Button } from '../../ui'");
        });

        it('imports shared modal AI selector primitives', () => {
            expect(source).toContain('ModalJobAiControls');
            expect(source).toContain('useModalJobAiSelection');
            expect(source).toContain('ResolvedModalJobAiSelection');
        });

        it('imports useState, useEffect, useCallback from react', () => {
            expect(source).toContain('import { useState, useEffect, useCallback }');
        });

        it('uses Dialog component with footer prop', () => {
            expect(source).toContain('<Dialog');
            expect(source).toContain('footer={');
        });

        it('uses Button variant primary and secondary', () => {
            expect(source).toContain('variant="primary"');
            expect(source).toContain('variant="secondary"');
        });
    });
});
