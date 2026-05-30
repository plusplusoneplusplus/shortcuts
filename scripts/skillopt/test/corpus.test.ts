/**
 * AC-02 tests: Task corpus schema and loader
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadCorpus, Task } from '../corpus';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'skillopt-corpus-test-'));
}

function writeCorpus(dir: string, tasks: unknown[]): string {
    const file = path.join(dir, 'tasks.json');
    fs.writeFileSync(file, JSON.stringify({ tasks }), 'utf-8');
    return file;
}

const VALID_TRAIN_TASK: Task = {
    id: 'train-1',
    prompt: 'Implement foo',
    visibleTests: 'echo visible',
    hiddenTests: 'echo hidden',
    judgeRubric: 'Is foo correct?',
    split: 'train',
};

const VALID_SELECTION_TASK: Task = {
    id: 'selection-1',
    prompt: 'Implement bar',
    split: 'selection',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('loadCorpus', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = makeTmpDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('loads a valid corpus and exposes splits', () => {
        writeCorpus(tmpDir, [VALID_TRAIN_TASK, VALID_SELECTION_TASK]);
        const corpus = loadCorpus(tmpDir);

        expect(corpus.tasks).toHaveLength(2);
        expect(corpus.trainTasks).toHaveLength(1);
        expect(corpus.selectionTasks).toHaveLength(1);
        expect(corpus.trainTasks[0].id).toBe('train-1');
        expect(corpus.selectionTasks[0].id).toBe('selection-1');
    });

    it('train and selection splits are disjoint', () => {
        writeCorpus(tmpDir, [VALID_TRAIN_TASK, VALID_SELECTION_TASK]);
        const corpus = loadCorpus(tmpDir);

        const trainIds = new Set(corpus.trainTasks.map(t => t.id));
        const selIds = new Set(corpus.selectionTasks.map(t => t.id));
        for (const id of selIds) {
            expect(trainIds.has(id)).toBe(false);
        }
    });

    it('accepts a tasks.json file path directly', () => {
        const file = writeCorpus(tmpDir, [VALID_TRAIN_TASK, VALID_SELECTION_TASK]);
        const corpus = loadCorpus(file);
        expect(corpus.tasks).toHaveLength(2);
    });

    it('validates required fields: id', () => {
        writeCorpus(tmpDir, [{ prompt: 'no id', split: 'train' }, VALID_SELECTION_TASK]);
        expect(() => loadCorpus(tmpDir)).toThrow(/id/i);
    });

    it('validates required fields: prompt', () => {
        writeCorpus(tmpDir, [{ id: 't1', split: 'train' }, VALID_SELECTION_TASK]);
        expect(() => loadCorpus(tmpDir)).toThrow(/prompt/i);
    });

    it('validates split values', () => {
        writeCorpus(tmpDir, [{ id: 't1', prompt: 'p', split: 'invalid' }, VALID_SELECTION_TASK]);
        expect(() => loadCorpus(tmpDir)).toThrow(/split/i);
    });

    it('rejects duplicate task IDs', () => {
        writeCorpus(tmpDir, [
            VALID_TRAIN_TASK,
            { ...VALID_TRAIN_TASK, split: 'selection' },
        ]);
        expect(() => loadCorpus(tmpDir)).toThrow(/duplicate/i);
    });

    it('requires at least one train task', () => {
        writeCorpus(tmpDir, [VALID_SELECTION_TASK]);
        expect(() => loadCorpus(tmpDir)).toThrow(/train/i);
    });

    it('requires at least one selection task', () => {
        writeCorpus(tmpDir, [VALID_TRAIN_TASK]);
        expect(() => loadCorpus(tmpDir)).toThrow(/selection/i);
    });

    it('validates 5-task seed corpus can be loaded', () => {
        const corpusPath = path.join(__dirname, '..', 'corpus');
        const corpus = loadCorpus(corpusPath);

        expect(corpus.tasks.length).toBeGreaterThanOrEqual(3);
        expect(corpus.trainTasks.length).toBeGreaterThanOrEqual(1);
        expect(corpus.selectionTasks.length).toBeGreaterThanOrEqual(1);

        // Schema-valid: all tasks have required fields
        for (const task of corpus.tasks) {
            expect(typeof task.id).toBe('string');
            expect(task.id.length).toBeGreaterThan(0);
            expect(typeof task.prompt).toBe('string');
            expect(task.prompt.length).toBeGreaterThan(0);
            expect(['train', 'selection']).toContain(task.split);
        }
    });

    it('loads optional fields when present', () => {
        const taskWithOptionals: Task = {
            id: 'opt-task',
            prompt: 'Do something',
            seedRef: 'main',
            visibleTests: 'echo ok',
            hiddenTests: 'echo ok',
            judgeRubric: 'Is it good?',
            split: 'train',
        };
        writeCorpus(tmpDir, [taskWithOptionals, VALID_SELECTION_TASK]);
        const corpus = loadCorpus(tmpDir);
        expect(corpus.trainTasks[0].seedRef).toBe('main');
        expect(corpus.trainTasks[0].visibleTests).toBe('echo ok');
        expect(corpus.trainTasks[0].judgeRubric).toBe('Is it good?');
    });
});
