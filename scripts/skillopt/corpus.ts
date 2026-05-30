/**
 * AC-02: Task corpus schema and loader.
 *
 * Schema (JSON file with a "tasks" array):
 *
 *   id          string  Unique identifier for the task.
 *   prompt      string  The coding task prompt shown to the target agent (+ skill).
 *   seedRef?    string  Git ref or seed directory used to prepare the worktree.
 *   visibleTests?  string  Shell command the agent can run to verify its work (shown in prompt).
 *   hiddenTests?   string  Shell command run post-rollout for scoring (NEVER shown to target).
 *   judgeRubric?   string  Rubric for the LLM judge scoring step.
 *   split       "train" | "selection"  Which split this task belongs to.
 *
 * The corpus must have ≥1 train task and ≥1 selection task.
 * Task IDs must be unique within the corpus.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Task {
    id: string;
    prompt: string;
    seedRef?: string;
    visibleTests?: string;
    hiddenTests?: string;
    judgeRubric?: string;
    split: 'train' | 'selection';
}

export interface Corpus {
    tasks: Task[];
    trainTasks: Task[];
    selectionTasks: Task[];
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateTask(raw: unknown): asserts raw is Task {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error(`Task must be an object, got: ${JSON.stringify(raw)}`);
    }
    const t = raw as Record<string, unknown>;

    if (typeof t.id !== 'string' || t.id.trim().length === 0) {
        throw new Error(`Task.id must be a non-empty string: ${JSON.stringify(raw)}`);
    }
    if (typeof t.prompt !== 'string' || t.prompt.trim().length === 0) {
        throw new Error(`Task ${t.id}: prompt must be a non-empty string`);
    }
    if (t.split !== 'train' && t.split !== 'selection') {
        throw new Error(`Task ${t.id}: split must be "train" or "selection", got "${t.split}"`);
    }
    for (const opt of ['seedRef', 'visibleTests', 'hiddenTests', 'judgeRubric'] as const) {
        if (t[opt] !== undefined && typeof t[opt] !== 'string') {
            throw new Error(`Task ${t.id}: ${opt} must be a string if provided`);
        }
    }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Loads a task corpus from a JSON file or a directory containing `tasks.json`.
 * Validates schema, checks splits, and checks for duplicate IDs.
 */
export function loadCorpus(corpusPath: string): Corpus {
    const resolved = path.resolve(corpusPath);
    let tasksFile = resolved;

    if (fs.statSync(resolved).isDirectory()) {
        tasksFile = path.join(resolved, 'tasks.json');
    }

    if (!fs.existsSync(tasksFile)) {
        throw new Error(`Corpus file not found: ${tasksFile}`);
    }

    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
    } catch (err) {
        throw new Error(`Failed to parse corpus JSON at ${tasksFile}: ${(err as Error).message}`);
    }

    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Record<string, unknown>).tasks)) {
        throw new Error(`Corpus file must be a JSON object with a "tasks" array: ${tasksFile}`);
    }

    const rawTasks: unknown[] = (raw as { tasks: unknown[] }).tasks;
    const tasks: Task[] = [];
    const seenIds = new Set<string>();

    for (const rawTask of rawTasks) {
        validateTask(rawTask);
        if (seenIds.has(rawTask.id)) {
            throw new Error(`Duplicate task ID in corpus: "${rawTask.id}"`);
        }
        seenIds.add(rawTask.id);
        tasks.push(rawTask);
    }

    const trainTasks = tasks.filter(t => t.split === 'train');
    const selectionTasks = tasks.filter(t => t.split === 'selection');

    if (trainTasks.length === 0) {
        throw new Error('Corpus must have at least one task with split="train"');
    }
    if (selectionTasks.length === 0) {
        throw new Error('Corpus must have at least one task with split="selection"');
    }

    return { tasks, trainTasks, selectionTasks };
}
