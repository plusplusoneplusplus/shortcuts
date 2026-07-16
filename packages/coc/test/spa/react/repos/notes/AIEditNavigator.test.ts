/**
 * Source-inspection tests for AIEditNavigator component.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC_PATH = path.resolve(
    __dirname,
    '../../../../../src/server/spa/client/react/features/notes/editor/AIEditNavigator.tsx',
);

describe('AIEditNavigator (source inspection)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(SRC_PATH, 'utf-8');
    });

    it('exports AIEditNavigator function', () => {
        expect(source).toContain('export function AIEditNavigator');
    });

    it('exports AIEditNavigatorProps interface', () => {
        expect(source).toContain('export interface AIEditNavigatorProps');
    });

    it('has editCount, onNext, onDismiss, narrow props', () => {
        expect(source).toContain('editCount: number');
        expect(source).toContain('onNext: () => void');
        expect(source).toContain('onDismiss: () => void');
        expect(source).toContain('narrow?');
    });

    it('returns null when editCount is 0', () => {
        expect(source).toContain('editCount === 0');
        expect(source).toContain('return null');
    });

    it('has test ids for next and dismiss buttons', () => {
        expect(source).toContain('ai-edit-navigator-next');
        expect(source).toContain('ai-edit-navigator-dismiss');
    });

    it('calls onNext on next button click', () => {
        expect(source).toContain('onClick={onNext}');
    });

    it('calls onDismiss on dismiss button click', () => {
        expect(source).toContain('onClick={onDismiss}');
    });

    it('has aria-live attribute for screen readers', () => {
        expect(source).toContain('aria-live');
    });

    it('supports narrow layout for compact display', () => {
        expect(source).toContain('narrow');
    });

    it('declares a placement prop on AIEditNavigatorProps', () => {
        expect(source).toContain('placement?');
        expect(source).toContain("'bottom-right' | 'top-right'");
    });

    it('defaults placement to bottom-right', () => {
        expect(source).toContain("placement = 'bottom-right'");
    });

    it('offers both corner anchors so the pill can clear the chat lens', () => {
        expect(source).toContain('bottom-8 right-3');
        expect(source).toContain('top-2 right-3');
    });

    it('renders dismiss button with a "Keep" text label, not a bare \u2715', () => {
        // Capture the exact dismiss button block so we don't accidentally match
        // unrelated text elsewhere in the file.
        const dismissBlockMatch = source.match(
            /<button[^>]*data-testid="ai-edit-navigator-dismiss"[^>]*>[\s\S]*?<\/button>/,
        );
        expect(dismissBlockMatch, 'dismiss <button> block should be present').toBeTruthy();

        const dismissBlock = dismissBlockMatch![0];
        expect(dismissBlock).toContain('Keep');
        expect(dismissBlock).not.toContain('\u2715');
    });

    it('gives the dismiss button a comfortable padded hit target', () => {
        // The proposed ~28px-tall hit target relies on horizontal + vertical
        // padding. Without padding the bare character regression returns.
        const dismissBlockMatch = source.match(
            /<button[^>]*data-testid="ai-edit-navigator-dismiss"[^>]*>[\s\S]*?<\/button>/,
        );
        expect(dismissBlockMatch).toBeTruthy();
        const dismissBlock = dismissBlockMatch![0];
        expect(dismissBlock).toMatch(/px-\d/);
        expect(dismissBlock).toMatch(/py-\d/);
    });

    it('renders a visual separator between navigation and dismiss actions', () => {
        // The separator is a non-interactive element that visually divides the
        // navigation arrow from the new "Keep" button.
        expect(source).toContain('ai-edit-navigator-separator');
        expect(source).toContain('aria-hidden="true"');
    });
});
