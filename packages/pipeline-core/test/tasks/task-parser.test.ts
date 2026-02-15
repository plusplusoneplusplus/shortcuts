import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    parseTaskStatus,
    updateTaskStatus,
    parseFileName,
    sanitizeFileName,
    VALID_TASK_STATUSES,
    COMMON_DOC_TYPES,
} from '../../src/tasks';

describe('task-parser', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-parser-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function writeFile(name: string, content: string): string {
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, content, 'utf-8');
        return filePath;
    }

    // ========================================================================
    // parseTaskStatus
    // ========================================================================

    describe('parseTaskStatus', () => {
        it('should parse status: pending', () => {
            const fp = writeFile('t.md', '---\nstatus: pending\n---\n# Hello');
            expect(parseTaskStatus(fp)).toBe('pending');
        });

        it('should parse status: in-progress', () => {
            const fp = writeFile('t.md', '---\nstatus: in-progress\n---\n# Hello');
            expect(parseTaskStatus(fp)).toBe('in-progress');
        });

        it('should parse status: done', () => {
            const fp = writeFile('t.md', '---\nstatus: done\n---\n# Hello');
            expect(parseTaskStatus(fp)).toBe('done');
        });

        it('should parse status: future', () => {
            const fp = writeFile('t.md', '---\nstatus: future\n---\n# Hello');
            expect(parseTaskStatus(fp)).toBe('future');
        });

        it('should return undefined for missing frontmatter', () => {
            const fp = writeFile('t.md', '# No frontmatter');
            expect(parseTaskStatus(fp)).toBeUndefined();
        });

        it('should return undefined for malformed YAML', () => {
            const fp = writeFile('t.md', '---\n: invalid: yaml: [}\n---\n');
            expect(parseTaskStatus(fp)).toBeUndefined();
        });

        it('should return undefined for invalid status value', () => {
            const fp = writeFile('t.md', '---\nstatus: cancelled\n---\n');
            expect(parseTaskStatus(fp)).toBeUndefined();
        });

        it('should return undefined for empty file', () => {
            const fp = writeFile('t.md', '');
            expect(parseTaskStatus(fp)).toBeUndefined();
        });

        it('should return undefined for file without closing ---', () => {
            const fp = writeFile('t.md', '---\nstatus: pending\nno closing');
            expect(parseTaskStatus(fp)).toBeUndefined();
        });

        it('should return undefined for non-existent file path', () => {
            expect(parseTaskStatus(path.join(tmpDir, 'nonexistent.md'))).toBeUndefined();
        });

        it('should return undefined for empty frontmatter', () => {
            const fp = writeFile('t.md', '---\n---\n# Body');
            expect(parseTaskStatus(fp)).toBeUndefined();
        });

        it('should return undefined when status is a number', () => {
            const fp = writeFile('t.md', '---\nstatus: 42\n---\n');
            expect(parseTaskStatus(fp)).toBeUndefined();
        });
    });

    // ========================================================================
    // updateTaskStatus
    // ========================================================================

    describe('updateTaskStatus', () => {
        it('should update existing frontmatter status', async () => {
            const fp = writeFile('t.md', '---\nstatus: pending\n---\n# Body');
            await updateTaskStatus(fp, 'done');
            expect(parseTaskStatus(fp)).toBe('done');
        });

        it('should add frontmatter to file without it', async () => {
            const fp = writeFile('t.md', '# No frontmatter\nSome body');
            await updateTaskStatus(fp, 'in-progress');
            const content = fs.readFileSync(fp, 'utf-8');
            expect(content.startsWith('---\n')).toBe(true);
            expect(parseTaskStatus(fp)).toBe('in-progress');
            // Body should be preserved
            expect(content).toContain('# No frontmatter');
            expect(content).toContain('Some body');
        });

        it('should preserve other frontmatter fields', async () => {
            const fp = writeFile('t.md', '---\ntitle: My Task\nstatus: pending\ntags: [a, b]\n---\n# Body');
            await updateTaskStatus(fp, 'future');
            const content = fs.readFileSync(fp, 'utf-8');
            expect(content).toContain('title: My Task');
            expect(content).toContain('status: future');
            expect(parseTaskStatus(fp)).toBe('future');
        });

        it('should preserve body content after frontmatter', async () => {
            const body = '\n# Title\n\nParagraph with **bold** text.\n\n- item 1\n- item 2\n';
            const fp = writeFile('t.md', `---\nstatus: pending\n---${body}`);
            await updateTaskStatus(fp, 'done');
            const content = fs.readFileSync(fp, 'utf-8');
            expect(content).toContain(body);
        });

        it('should handle empty frontmatter section', async () => {
            const fp = writeFile('t.md', '---\n---\n# Body');
            await updateTaskStatus(fp, 'pending');
            expect(parseTaskStatus(fp)).toBe('pending');
        });
    });

    // ========================================================================
    // parseFileName
    // ========================================================================

    describe('parseFileName', () => {
        it('should parse simple filename', () => {
            expect(parseFileName('task1.md')).toEqual({ baseName: 'task1', docType: undefined });
        });

        it('should parse filename with doc type', () => {
            expect(parseFileName('task1.plan.md')).toEqual({ baseName: 'task1', docType: 'plan' });
        });

        it('should parse filename with multiple dots (last doc type wins)', () => {
            expect(parseFileName('task1.test.spec.md')).toEqual({ baseName: 'task1.test', docType: 'spec' });
        });

        it('should parse version suffixes like v2', () => {
            expect(parseFileName('task.v2.md')).toEqual({ baseName: 'task', docType: 'v2' });
        });

        it('should return no doc type for unknown suffix', () => {
            expect(parseFileName('my-feature.md')).toEqual({ baseName: 'my-feature', docType: undefined });
        });

        it('should handle case-insensitive .md extension', () => {
            expect(parseFileName('task.plan.MD')).toEqual({ baseName: 'task', docType: 'plan' });
        });

        it('should handle filename with no extension match', () => {
            expect(parseFileName('task')).toEqual({ baseName: 'task', docType: undefined });
        });

        it('should handle unknown multi-dot suffix', () => {
            expect(parseFileName('file.custom.md')).toEqual({ baseName: 'file.custom', docType: undefined });
        });

        it('should recognize high version numbers', () => {
            expect(parseFileName('task.v99.md')).toEqual({ baseName: 'task', docType: 'v99' });
        });

        it('should handle all common doc types', () => {
            for (const docType of COMMON_DOC_TYPES) {
                const result = parseFileName(`task.${docType}.md`);
                expect(result.docType).toBe(docType);
                expect(result.baseName).toBe('task');
            }
        });
    });

    // ========================================================================
    // sanitizeFileName
    // ========================================================================

    describe('sanitizeFileName', () => {
        it('should replace invalid characters with hyphens', () => {
            expect(sanitizeFileName('file<>:"/\\|?*name')).toBe('file-name');
        });

        it('should collapse whitespace into hyphens', () => {
            expect(sanitizeFileName('hello   world')).toBe('hello-world');
        });

        it('should collapse consecutive hyphens', () => {
            expect(sanitizeFileName('a---b')).toBe('a-b');
        });

        it('should trim leading and trailing hyphens', () => {
            expect(sanitizeFileName('-hello-')).toBe('hello');
        });

        it('should pass through clean names unchanged', () => {
            expect(sanitizeFileName('clean-file-name')).toBe('clean-file-name');
        });

        it('should handle mixed invalid chars and whitespace', () => {
            expect(sanitizeFileName('  <hello>  world?  ')).toBe('hello-world');
        });

        it('should handle empty string', () => {
            expect(sanitizeFileName('')).toBe('');
        });

        it('should handle string of only invalid chars', () => {
            expect(sanitizeFileName('***')).toBe('');
        });
    });

    // ========================================================================
    // Constants
    // ========================================================================

    describe('VALID_TASK_STATUSES', () => {
        it('should contain exactly the four valid statuses', () => {
            expect(VALID_TASK_STATUSES).toEqual(['pending', 'in-progress', 'done', 'future']);
        });
    });

    describe('COMMON_DOC_TYPES', () => {
        it('should contain expected doc types', () => {
            expect(COMMON_DOC_TYPES).toContain('plan');
            expect(COMMON_DOC_TYPES).toContain('spec');
            expect(COMMON_DOC_TYPES).toContain('test');
            expect(COMMON_DOC_TYPES).toContain('impl');
            expect(COMMON_DOC_TYPES).toContain('review');
        });

        it('should be a non-empty array of strings', () => {
            expect(COMMON_DOC_TYPES.length).toBeGreaterThan(0);
            for (const t of COMMON_DOC_TYPES) {
                expect(typeof t).toBe('string');
            }
        });
    });
});
