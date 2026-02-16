/**
 * Tests for repo-fixtures.ts
 *
 * Verifies that createRepoFixture() and createTasksFixture() produce the
 * expected on-disk structures for E2E tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRepoFixture, createTasksFixture } from '../e2e/fixtures/repo-fixtures';

describe('repo-fixtures', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-fix-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('createRepoFixture', () => {
        it('returns path to test-repo directory', () => {
            const repoDir = createRepoFixture(tmpDir);
            expect(repoDir).toBe(path.join(tmpDir, 'test-repo'));
            expect(fs.existsSync(repoDir)).toBe(true);
        });

        it('creates subdirs for path browser (src, docs)', () => {
            const repoDir = createRepoFixture(tmpDir);
            expect(fs.statSync(path.join(repoDir, 'src')).isDirectory()).toBe(true);
            expect(fs.statSync(path.join(repoDir, 'docs')).isDirectory()).toBe(true);
        });

        it('initialises a git repository', () => {
            const repoDir = createRepoFixture(tmpDir);
            expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(true);
        });

        it('creates pipeline.yaml for pipeline discovery', () => {
            const repoDir = createRepoFixture(tmpDir);
            const yamlPath = path.join(repoDir, '.vscode', 'pipelines', 'p1', 'pipeline.yaml');
            expect(fs.existsSync(yamlPath)).toBe(true);

            const content = fs.readFileSync(yamlPath, 'utf-8');
            expect(content).toContain('name: "test-pipeline"');
            expect(content).toContain('input:');
        });

        it('creates placeholder source files', () => {
            const repoDir = createRepoFixture(tmpDir);
            expect(fs.existsSync(path.join(repoDir, 'src', 'index.ts'))).toBe(true);
            expect(fs.existsSync(path.join(repoDir, 'docs', 'README.md'))).toBe(true);
        });
    });

    describe('createTasksFixture', () => {
        let repoDir: string;

        beforeEach(() => {
            repoDir = createRepoFixture(tmpDir);
        });

        it('creates root-level task files with correct frontmatter', () => {
            createTasksFixture(repoDir);
            const tasksDir = path.join(repoDir, '.vscode', 'tasks');

            const taskA = fs.readFileSync(path.join(tasksDir, 'task-a.md'), 'utf-8');
            expect(taskA).toContain('status: pending');
            expect(taskA).toContain('# Task A');

            const taskB = fs.readFileSync(path.join(tasksDir, 'task-b.md'), 'utf-8');
            expect(taskB).toContain('status: done');
        });

        it('creates document group files (feature.plan.md, feature.spec.md)', () => {
            createTasksFixture(repoDir);
            const tasksDir = path.join(repoDir, '.vscode', 'tasks');

            const plan = fs.readFileSync(path.join(tasksDir, 'feature.plan.md'), 'utf-8');
            expect(plan).toContain('status: in-progress');

            const spec = fs.readFileSync(path.join(tasksDir, 'feature.spec.md'), 'utf-8');
            expect(spec).toContain('status: pending');
        });

        it('creates nested folder with task file', () => {
            createTasksFixture(repoDir);
            const itemPath = path.join(repoDir, '.vscode', 'tasks', 'backlog', 'item.md');
            expect(fs.existsSync(itemPath)).toBe(true);

            const content = fs.readFileSync(itemPath, 'utf-8');
            expect(content).toContain('status: future');
        });

        it('creates archive folder with archived task', () => {
            createTasksFixture(repoDir);
            const archivePath = path.join(repoDir, '.vscode', 'tasks', 'archive', 'old.md');
            expect(fs.existsSync(archivePath)).toBe(true);

            const content = fs.readFileSync(archivePath, 'utf-8');
            expect(content).toContain('status: done');
        });

        it('all task files contain valid YAML frontmatter', () => {
            createTasksFixture(repoDir);
            const tasksDir = path.join(repoDir, '.vscode', 'tasks');

            const files = [
                'task-a.md',
                'task-b.md',
                'feature.plan.md',
                'feature.spec.md',
                'backlog/item.md',
                'archive/old.md',
            ];
            for (const rel of files) {
                const content = fs.readFileSync(path.join(tasksDir, rel), 'utf-8');
                expect(content).toMatch(/^---\nstatus: \S+\n---\n/);
            }
        });
    });
});
