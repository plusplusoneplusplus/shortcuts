/**
 * SPA Dashboard Tests — client bundle detail module
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

describe('client bundle — detail module', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('renders metadata grid', () => {
        expect(script).toContain('meta-grid');
        expect(script).toContain('meta-item');
    });

    it('renders child summary table for group types', () => {
        expect(script).toContain('child-summary');
        expect(script).toContain('child-table');
        expect(script).toContain('code-review-group');
        expect(script).toContain('pipeline-execution');
    });

    it('renders collapsible prompt section', () => {
        expect(script).toContain('prompt-section');
        expect(script).toContain('fullPrompt');
    });

    it('renders model in metadata grid when available', () => {
        expect(script).toContain('.metadata.model');
        expect(script).toContain('Model</label>');
    });

    it('renders working directory in metadata grid when available', () => {
        expect(script).toContain('.workingDirectory');
        expect(script).toContain('Working Directory</label>');
        expect(script).toContain('meta-path');
    });

    it('renders action buttons', () => {
        expect(script).toContain('Copy Result');
        expect(script).toContain('Copy Link');
    });

    it('markdown renderer handles headers', () => {
        expect(script).toContain('headerMatch');
    });

    it('markdown renderer handles code blocks', () => {
        expect(script).toContain('inCodeBlock');
        expect(script).toContain('language-');
    });

    it('markdown renderer handles lists', () => {
        expect(script).toContain('inList');
        expect(script).toContain('<ul>');
        expect(script).toContain('<ol>');
    });

    it('markdown renderer handles blockquotes', () => {
        expect(script).toContain('inBlockquote');
        expect(script).toContain('<blockquote>');
    });

    it('markdown renderer handles inline formatting', () => {
        expect(script).toContain('inlineFormat');
        expect(script).toContain('<strong>');
        expect(script).toContain('<em>');
    });

    it('markdown renderer handles links', () => {
        expect(script).toContain('target="_blank"');
        expect(script).toContain('rel="noopener"');
    });
});
