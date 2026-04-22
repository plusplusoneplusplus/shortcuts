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
});
