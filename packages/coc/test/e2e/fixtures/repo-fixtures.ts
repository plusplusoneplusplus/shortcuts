/**
 * Shared Repo & Tasks Fixture Helpers for E2E Tests
 *
 * Creates realistic on-disk repo structures that the server endpoints
 * (git-info, pipelines, tasks, fs/browse) can operate on.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Create a minimal repo fixture inside `tmpDir`.
 *
 * Structure created:
 *   test-repo/
 *   ├── .git/                          (bare git init)
 *   ├── src/
 *   │   └── index.ts
 *   ├── docs/
 *   │   └── README.md
 *   └── .vscode/
 *       └── pipelines/
 *           └── p1/
 *               └── pipeline.yaml
 *
 * @returns Absolute path to the created repo directory.
 */
export function createRepoFixture(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'test-repo');

    // Directories for path browser exploration
    const dirs = [
        path.join(repoDir, 'src'),
        path.join(repoDir, 'docs'),
        path.join(repoDir, '.vscode', 'workflows', 'p1'),
    ];
    for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Placeholder source files
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export default {};\n');
    fs.writeFileSync(path.join(repoDir, 'docs', 'README.md'), '# Docs\n');

    // Pipeline for discovery endpoint
    fs.writeFileSync(
        path.join(repoDir, '.vscode', 'workflows', 'p1', 'pipeline.yaml'),
        [
            'name: "test-pipeline"',
            'description: "Fixture pipeline for E2E tests"',
            'input:',
            '  type: csv',
            '  path: "input.csv"',
            'map:',
            '  prompt: "Analyze {{title}}"',
            '  output:',
            '    - result',
            'reduce:',
            '  type: json',
        ].join('\n') + '\n',
    );

    // git init so git-info endpoint works
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git add -A', { cwd: repoDir, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "init" --allow-empty', {
        cwd: repoDir,
        stdio: 'ignore',
    });

    return repoDir;
}

/**
 * Populate the tasks directory inside an existing repo directory.
 *
 * Structure created:
 *   <tasksDir>/
 *   ├── task-a.md              (pending)
 *   ├── task-b.md              (done)
 *   ├── feature.plan.md        (in-progress)
 *   ├── feature.spec.md        (pending)
 *   ├── backlog/
 *   │   └── item.md            (future)
 *   └── archive/
 *       └── old.md             (done)
 */
export function createTasksFixture(repoDir: string): void {
    const tasksDir = path.join(repoDir, '.vscode', 'tasks');
    fs.mkdirSync(path.join(tasksDir, 'backlog'), { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });

    const files: Record<string, string> = {
        'task-a.md': '---\nstatus: pending\n---\n\n# Task A\n\nRoot-level pending task.\n',
        'task-b.md': '---\nstatus: done\n---\n\n# Task B\n\nRoot-level completed task.\n',
        'feature.plan.md':
            '---\nstatus: in-progress\n---\n\n# Feature Plan\n\nPlanning document.\n',
        'feature.spec.md': '---\nstatus: pending\n---\n\n# Feature Spec\n\nSpecification document.\n',
        'backlog/item.md': '---\nstatus: future\n---\n\n# Backlog Item\n\nNested backlog task.\n',
        'archive/old.md': '---\nstatus: done\n---\n\n# Old Task\n\nArchived task.\n',
    };

    for (const [rel, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(tasksDir, rel), content);
    }
}

/**
 * Populate the tasks directory with tasks including an empty subfolder.
 *
 * Structure created:
 *   <tasksDir>/
 *   ├── task-a.md              (pending)
 *   ├── task-b.md              (done)
 *   ├── feature.plan.md        (in-progress)
 *   ├── backlog/
 *   │   └── item.md            (future)
 *   ├── archive/
 *   │   └── old.md             (done)
 *   └── empty-folder/          (no files)
 */
export function createTasksWithEmptyFolderFixture(repoDir: string): void {
    const tasksDir = path.join(repoDir, '.vscode', 'tasks');
    fs.mkdirSync(path.join(tasksDir, 'backlog'), { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'archive'), { recursive: true });
    fs.mkdirSync(path.join(tasksDir, 'empty-folder'), { recursive: true });

    const files: Record<string, string> = {
        'task-a.md': '---\nstatus: pending\n---\n\n# Task A\n\nRoot-level pending task.\n',
        'task-b.md': '---\nstatus: done\n---\n\n# Task B\n\nRoot-level completed task.\n',
        'feature.plan.md':
            '---\nstatus: in-progress\n---\n\n# Feature Plan\n\nPlanning document.\n',
        'backlog/item.md': '---\nstatus: future\n---\n\n# Backlog Item\n\nNested backlog task.\n',
        'archive/old.md': '---\nstatus: done\n---\n\n# Old Task\n\nArchived task.\n',
    };

    for (const [rel, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(tasksDir, rel), content);
    }
}

/**
 * Populate the tasks directory with a deeply nested structure for scroll tests.
 *
 * Structure created:
 *   <tasksDir>/
 *   ├── task-root.md
 *   ├── level1/
 *   │   ├── task-l1.md
 *   │   └── level2/
 *   │       ├── task-l2.md
 *   │       └── level3/
 *   │           └── deep-task.md
 */
export function createDeepTasksFixture(repoDir: string): void {
    const tasksDir = path.join(repoDir, '.vscode', 'tasks');
    fs.mkdirSync(path.join(tasksDir, 'level1', 'level2', 'level3'), { recursive: true });

    const files: Record<string, string> = {
        'task-root.md': '---\nstatus: pending\n---\n\n# Root Task\n\nRoot-level task.\n',
        'level1/task-l1.md': '---\nstatus: pending\n---\n\n# Level 1 Task\n\nFirst level task.\n',
        'level1/level2/task-l2.md': '---\nstatus: in-progress\n---\n\n# Level 2 Task\n\nSecond level task.\n',
        'level1/level2/level3/deep-task.md': '---\nstatus: pending\n---\n\n# Deep Task\n\nDeeply nested task.\n',
    };

    for (const [rel, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(tasksDir, rel), content);
    }
}
