/**
 * The mode directive is the whole enforcement mechanism for ask mode (the tool
 * layer auto-approves Bash and file edits), so its content contract is pinned
 * here: what each mode emits, what a mode switch announces, and the fact that
 * a fresh autopilot chat emits nothing at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/forge';
import {
    CHAT_MODE_DIRECTIVE_TAG,
    MODE_SWITCHED_TO_AUTOPILOT_NOTE,
    buildChatModeDirective,
    loadChatModeInstructions,
    prependChatModeDirective,
} from '../../../src/server/executors/chat-mode-directive';

// ============================================================================
// buildChatModeDirective
// ============================================================================

describe('buildChatModeDirective', () => {
    it('emits the read-only prose in a tagged block for ask mode', () => {
        const directive = buildChatModeDirective({ mode: 'ask' })!;

        expect(directive.startsWith(`<${CHAT_MODE_DIRECTIVE_TAG}>`)).toBe(true);
        expect(directive.endsWith(`</${CHAT_MODE_DIRECTIVE_TAG}>`)).toBe(true);
        expect(directive).toContain(READ_ONLY_SYSTEM_MESSAGE.trim());
    });

    it('normalizes legacy plan mode to ask', () => {
        const plan = buildChatModeDirective({ mode: 'plan' as never })!;

        expect(plan).toBe(buildChatModeDirective({ mode: 'ask' }));
    });

    it('announces the switch when a chat leaves ask mode', () => {
        for (const mode of ['autopilot', 'ralph'] as const) {
            const directive = buildChatModeDirective({ mode, previousMode: 'ask' })!;

            expect(directive).toContain(MODE_SWITCHED_TO_AUTOPILOT_NOTE);
            expect(directive).not.toContain('coc-read-only-mode');
        }
    });

    it('says nothing on a fresh autopilot chat', () => {
        expect(buildChatModeDirective({ mode: 'autopilot' })).toBeUndefined();
        expect(buildChatModeDirective({ mode: 'autopilot', previousMode: 'autopilot' })).toBeUndefined();
        expect(buildChatModeDirective({ mode: 'ralph', previousMode: 'ralph' })).toBeUndefined();
    });

    it('drops the transition note once the chat has settled in autopilot', () => {
        // Re-announcing on every autopilot turn would be noise; the note is a
        // correction to what the model was told earlier, not standing guidance.
        expect(buildChatModeDirective({ mode: 'autopilot', previousMode: 'autopilot' })).toBeUndefined();
    });

    it('re-states the read-only block when a chat switches back to ask', () => {
        const directive = buildChatModeDirective({ mode: 'ask', previousMode: 'autopilot' })!;

        expect(directive).toContain(READ_ONLY_SYSTEM_MESSAGE.trim());
    });

    it('appends mode instructions after the mode prose', () => {
        const directive = buildChatModeDirective({
            mode: 'ask',
            modeInstructions: '<custom_instruction>\nASK-RULES\n</custom_instruction>',
        })!;

        expect(directive.indexOf('ASK-RULES')).toBeGreaterThan(directive.indexOf('read-only mode'));
    });

    it('carries mode instructions alone when the mode itself has nothing to say', () => {
        const directive = buildChatModeDirective({
            mode: 'autopilot',
            modeInstructions: 'AUTOPILOT-RULES',
        })!;

        expect(directive).toBe(`<${CHAT_MODE_DIRECTIVE_TAG}>\nAUTOPILOT-RULES\n</${CHAT_MODE_DIRECTIVE_TAG}>`);
    });

    it('ignores blank mode instructions', () => {
        expect(buildChatModeDirective({ mode: 'autopilot', modeInstructions: '   \n' })).toBeUndefined();
    });
});

// ============================================================================
// prependChatModeDirective
// ============================================================================

describe('prependChatModeDirective', () => {
    it('puts the directive in front of the prompt', () => {
        expect(prependChatModeDirective('do the thing', 'DIRECTIVE')).toBe('DIRECTIVE\n\ndo the thing');
    });

    it('is the identity when there is no directive', () => {
        const prompt = 'do the thing';

        expect(prependChatModeDirective(prompt, undefined)).toBe(prompt);
    });
});

// ============================================================================
// loadChatModeInstructions
// ============================================================================

describe('loadChatModeInstructions', () => {
    let repoDir: string;

    beforeEach(() => {
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mode-instructions-'));
        const instructionDir = path.join(repoDir, '.github', 'coc');
        fs.mkdirSync(instructionDir, { recursive: true });
        fs.writeFileSync(path.join(instructionDir, 'instructions.md'), 'SHARED-INSTRUCTIONS');
        fs.writeFileSync(path.join(instructionDir, 'instructions-ask.md'), 'ASK-ONLY-INSTRUCTIONS');
        fs.writeFileSync(path.join(instructionDir, 'instructions-autopilot.md'), 'AUTOPILOT-ONLY-INSTRUCTIONS');
    });

    afterEach(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('loads only the mode half — the shared half stays in the system prompt', async () => {
        const ask = await loadChatModeInstructions(repoDir, 'ask');

        expect(ask).toContain('ASK-ONLY-INSTRUCTIONS');
        expect(ask).not.toContain('SHARED-INSTRUCTIONS');
    });

    it('maps ralph to the autopilot instruction file', async () => {
        const ralph = await loadChatModeInstructions(repoDir, 'ralph');

        expect(ralph).toContain('AUTOPILOT-ONLY-INSTRUCTIONS');
    });

    it('returns undefined without a working directory or mode', async () => {
        expect(await loadChatModeInstructions(undefined, 'ask')).toBeUndefined();
        expect(await loadChatModeInstructions(repoDir, undefined)).toBeUndefined();
    });

    it('returns undefined when the repo has no mode instruction file', async () => {
        const emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-no-instructions-'));
        try {
            expect(await loadChatModeInstructions(emptyRepo, 'ask')).toBeUndefined();
        } finally {
            fs.rmSync(emptyRepo, { recursive: true, force: true });
        }
    });
});
