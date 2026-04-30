/**
 * Note Create Executor Tests
 *
 * Tests for the AI response parser and tree compaction logic
 * in NoteCreateExecutor.
 */

import { describe, it, expect } from 'vitest';
import { parseNoteCreateResponse } from '../../../src/server/executors/note-create-executor';

// ============================================================================
// parseNoteCreateResponse
// ============================================================================

describe('parseNoteCreateResponse', () => {
    it('parses a valid JSON response', () => {
        const raw = JSON.stringify({
            parentPath: 'Research',
            title: 'Q4 Roadmap Discussion',
            createNotebook: false,
        });
        const result = parseNoteCreateResponse(raw);
        expect(result.parentPath).toBe('Research');
        expect(result.title).toBe('Q4 Roadmap Discussion');
        expect(result.createNotebook).toBe(false);
        expect(result.newNotebookName).toBeUndefined();
    });

    it('parses response with createNotebook=true and newNotebookName', () => {
        const raw = JSON.stringify({
            parentPath: '',
            title: 'Meeting Notes',
            createNotebook: true,
            newNotebookName: 'Meetings',
        });
        const result = parseNoteCreateResponse(raw);
        expect(result.parentPath).toBe('');
        expect(result.title).toBe('Meeting Notes');
        expect(result.createNotebook).toBe(true);
        expect(result.newNotebookName).toBe('Meetings');
    });

    it('strips markdown code fences from response', () => {
        const raw = '```json\n{\n  "parentPath": "Projects",\n  "title": "New Feature",\n  "createNotebook": false\n}\n```';
        const result = parseNoteCreateResponse(raw);
        expect(result.parentPath).toBe('Projects');
        expect(result.title).toBe('New Feature');
    });

    it('strips code fences without language tag', () => {
        const raw = '```\n{"parentPath": "", "title": "Test", "createNotebook": false}\n```';
        const result = parseNoteCreateResponse(raw);
        expect(result.title).toBe('Test');
    });

    it('sanitizes invalid characters from title', () => {
        const raw = JSON.stringify({
            parentPath: '',
            title: 'My/Note:With*Bad?Chars',
            createNotebook: false,
        });
        const result = parseNoteCreateResponse(raw);
        expect(result.title).toBe('MyNoteWithBadChars');
    });

    it('sanitizes invalid characters from newNotebookName', () => {
        const raw = JSON.stringify({
            parentPath: '',
            title: 'Test',
            createNotebook: true,
            newNotebookName: 'Bad<Name>Here',
        });
        const result = parseNoteCreateResponse(raw);
        expect(result.newNotebookName).toBe('BadNameHere');
    });

    it('throws for empty title', () => {
        const raw = JSON.stringify({
            parentPath: '',
            title: '',
            createNotebook: false,
        });
        expect(() => parseNoteCreateResponse(raw)).toThrow('missing "title"');
    });

    it('throws for missing title field', () => {
        const raw = JSON.stringify({
            parentPath: '',
            createNotebook: false,
        });
        expect(() => parseNoteCreateResponse(raw)).toThrow('missing "title"');
    });

    it('throws for missing parentPath field', () => {
        const raw = JSON.stringify({
            title: 'Test',
            createNotebook: false,
        });
        expect(() => parseNoteCreateResponse(raw)).toThrow('missing "parentPath"');
    });

    it('throws for non-JSON response', () => {
        expect(() => parseNoteCreateResponse('not json')).toThrow();
    });

    it('throws for non-object response', () => {
        expect(() => parseNoteCreateResponse('"a string"')).toThrow();
    });

    it('handles whitespace around the JSON', () => {
        const raw = `  \n  {"parentPath": "Notes", "title": "Clean", "createNotebook": false}  \n  `;
        const result = parseNoteCreateResponse(raw);
        expect(result.title).toBe('Clean');
        expect(result.parentPath).toBe('Notes');
    });

    it('handles nested section paths', () => {
        const raw = JSON.stringify({
            parentPath: 'Research/Papers',
            title: 'Attention Is All You Need',
            createNotebook: false,
        });
        const result = parseNoteCreateResponse(raw);
        expect(result.parentPath).toBe('Research/Papers');
    });
});
