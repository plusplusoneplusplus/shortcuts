/**
 * SPA Dashboard Tests — Copy Path feature in React Tasks panel.
 *
 * Tests that the TaskActions component provides copy path functionality.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

// ============================================================================
// Copy Path — React TaskActions component
// ============================================================================

describe('Copy Path — React TaskActions component', () => {
    const actionsFile = path.join(CLIENT_DIR, 'react', 'tasks', 'TaskActions.tsx');

    it('TaskActions.tsx exists', () => {
        expect(fs.existsSync(actionsFile)).toBe(true);
    });

    it('renders Copy path button', () => {
        const content = fs.readFileSync(actionsFile, 'utf8');
        expect(content).toContain('Copy path');
    });

    it('renders Open in editor button', () => {
        const content = fs.readFileSync(actionsFile, 'utf8');
        expect(content).toContain('Open in editor');
    });

    it('uses clipboard API to copy path', () => {
        const content = fs.readFileSync(actionsFile, 'utf8');
        expect(content).toContain('copyToClipboard');
        expect(content).toContain('navigator.clipboard');
    });

    it('calls open-file API endpoint', () => {
        const content = fs.readFileSync(actionsFile, 'utf8');
        expect(content).toContain('/open-file');
    });

    it('shows copy path only when openFilePath is set', () => {
        const content = fs.readFileSync(actionsFile, 'utf8');
        expect(content).toContain('openFilePath');
    });
});
