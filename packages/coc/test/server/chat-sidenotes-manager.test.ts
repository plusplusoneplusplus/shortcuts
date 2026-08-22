import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    ChatSideNotesManager,
    MAX_SIDENOTES_PER_PROCESS,
    MAX_TURNS_PER_SIDENOTE,
    buildSideNoteLabel,
    fingerprintSelection,
    threadTurns,
} from '../../src/server/processes/chat-sidenotes/chat-sidenotes-manager';

describe('ChatSideNotesManager', () => {
    let dataDir: string;
    let manager: ChatSideNotesManager;
    const wsId = 'ws-test';
    const processId = 'queue_abc-123';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sidenotes-'));
        manager = new ChatSideNotesManager(dataDir);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function baseNote(overrides: Record<string, unknown> = {}) {
        return {
            turnIndex: 2,
            anchor: {
                selectedText: 'Daly formula',
                contextBefore: 'the ',
                contextAfter: ' explains',
                fingerprint: fingerprintSelection('Daly formula'),
            },
            answer: 'A metric formula.',
            label: buildSideNoteLabel('Daly formula'),
            ...overrides,
        } as any;
    }

    it('returns an empty list for an unknown process', async () => {
        expect(await manager.list(wsId, processId)).toEqual([]);
    });

    it('adds and lists a side-note, generating id/processId/createdAt', async () => {
        const created = await manager.add(wsId, processId, baseNote());
        expect(created.id).toBeTruthy();
        expect(created.processId).toBe(processId);
        expect(created.createdAt).toBeTruthy();
        expect(created.turnIndex).toBe(2);

        const list = await manager.list(wsId, processId);
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(created.id);
        expect(list[0].answer).toBe('A metric formula.');
    });

    it('stores files under the repo-scoped chat-sidenotes directory', async () => {
        await manager.add(wsId, processId, baseNote());
        const dir = path.join(dataDir, 'repos', wsId, 'chat-sidenotes');
        expect(fs.existsSync(dir)).toBe(true);
        const files = fs.readdirSync(dir);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(/\.json$/);
    });

    it('isolates side-notes per process', async () => {
        await manager.add(wsId, 'proc-a', baseNote({ answer: 'A' }));
        await manager.add(wsId, 'proc-b', baseNote({ answer: 'B' }));
        expect(await manager.list(wsId, 'proc-a')).toHaveLength(1);
        expect((await manager.list(wsId, 'proc-b'))[0].answer).toBe('B');
    });

    it('deletes a side-note by id and reports success', async () => {
        const a = await manager.add(wsId, processId, baseNote({ answer: 'A' }));
        await manager.add(wsId, processId, baseNote({ answer: 'B' }));
        expect(await manager.delete(wsId, processId, a.id)).toBe(true);
        const remaining = await manager.list(wsId, processId);
        expect(remaining).toHaveLength(1);
        expect(remaining[0].answer).toBe('B');
    });

    it('returns false when deleting a missing id', async () => {
        await manager.add(wsId, processId, baseNote());
        expect(await manager.delete(wsId, processId, 'nope')).toBe(false);
        expect(await manager.list(wsId, processId)).toHaveLength(1);
    });

    it('trims to the max, dropping the oldest entries', async () => {
        for (let i = 0; i < MAX_SIDENOTES_PER_PROCESS + 5; i++) {
            await manager.add(wsId, processId, baseNote({ answer: `note-${i}` }));
        }
        const list = await manager.list(wsId, processId);
        expect(list).toHaveLength(MAX_SIDENOTES_PER_PROCESS);
        // Oldest (note-0..note-4) dropped; newest retained.
        expect(list[list.length - 1].answer).toBe(`note-${MAX_SIDENOTES_PER_PROCESS + 4}`);
        expect(list.some(n => n.answer === 'note-0')).toBe(false);
    });

    it('tolerates a corrupted storage file', async () => {
        await manager.add(wsId, processId, baseNote());
        const dir = path.join(dataDir, 'repos', wsId, 'chat-sidenotes');
        const file = path.join(dir, fs.readdirSync(dir)[0]);
        fs.writeFileSync(file, '{ not json', 'utf8');
        expect(await manager.list(wsId, processId)).toEqual([]);
    });
});

describe('buildSideNoteLabel', () => {
    it('keeps short selections verbatim', () => {
        expect(buildSideNoteLabel('MTBF')).toBe('MTBF');
    });
    it('truncates long selections to ~22 chars with an ellipsis', () => {
        const label = buildSideNoteLabel('this is a very long selected phrase indeed');
        expect(label.endsWith('…')).toBe(true);
        expect(label.length).toBeLessThanOrEqual(23);
    });
    it('collapses whitespace', () => {
        expect(buildSideNoteLabel('  a\n b  ')).toBe('a b');
    });
});

describe('fingerprintSelection', () => {
    it('is stable regardless of surrounding whitespace', () => {
        expect(fingerprintSelection('Daly formula')).toBe(fingerprintSelection('  Daly   formula '));
    });
    it('differs for different text', () => {
        expect(fingerprintSelection('a')).not.toBe(fingerprintSelection('b'));
    });
});

describe('threadTurns', () => {
    const note = (overrides: Record<string, unknown>) => ({
        id: 'n1', processId: 'p1', turnIndex: 0,
        anchor: { selectedText: 's', contextBefore: '', contextAfter: '', fingerprint: '' },
        answer: 'one-shot answer', label: 's', createdAt: '',
        ...overrides,
    }) as any;

    it('synthesizes turn 0 for a note written before follow-ups existed', () => {
        expect(threadTurns(note({ question: 'why?' }))).toEqual([
            { question: 'why?', answer: 'one-shot answer' },
        ]);
    });

    it('treats an empty turns array as no thread', () => {
        expect(threadTurns(note({ turns: [] }))).toHaveLength(1);
    });

    it('returns the persisted thread when present', () => {
        const turns = [{ answer: 'a' }, { question: 'q', answer: 'b' }];
        expect(threadTurns(note({ turns }))).toEqual(turns);
    });
});

describe('ChatSideNotesManager.appendTurn', () => {
    let dataDir: string;
    let manager: ChatSideNotesManager;
    const wsId = 'ws-test';
    const processId = 'queue_abc-123';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-sidenotes-turns-'));
        manager = new ChatSideNotesManager(dataDir);
    });
    afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

    async function seed() {
        return manager.add(wsId, processId, {
            turnIndex: 0,
            anchor: { selectedText: 'Daly formula', contextBefore: '', contextAfter: '', fingerprint: '' },
            question: 'what is it?',
            answer: 'A metric formula.',
            label: 'Daly formula',
        } as any);
    }

    it('seeds the thread from question/answer and appends the new turn', async () => {
        const created = await seed();
        const updated = await manager.appendTurn(wsId, processId, created.id, { question: 'why?', answer: 'Because.' });
        expect(updated!.turns).toEqual([
            { question: 'what is it?', answer: 'A metric formula.' },
            { question: 'why?', answer: 'Because.' },
        ]);
        // Persisted, and the other fields are untouched.
        const [reloaded] = await manager.list(wsId, processId);
        expect(reloaded.turns).toHaveLength(2);
        expect(reloaded.answer).toBe('A metric formula.');
        expect(reloaded.createdAt).toBe(created.createdAt);
    });

    it('leaves sibling notes alone', async () => {
        const first = await seed();
        const second = await seed();
        await manager.appendTurn(wsId, processId, first.id, { question: 'q', answer: 'a' });
        const notes = await manager.list(wsId, processId);
        expect(notes.find(n => n.id === first.id)!.turns).toHaveLength(2);
        expect(notes.find(n => n.id === second.id)!.turns).toBeUndefined();
    });

    it('returns null for an unknown id', async () => {
        await seed();
        expect(await manager.appendTurn(wsId, processId, 'missing', { answer: 'a' })).toBeNull();
    });

    it('returns null once the thread is at the turn cap', async () => {
        const created = await seed();
        for (let i = 0; i < MAX_TURNS_PER_SIDENOTE - 1; i++) {
            expect(await manager.appendTurn(wsId, processId, created.id, { question: `q${i}`, answer: `a${i}` })).not.toBeNull();
        }
        expect(await manager.appendTurn(wsId, processId, created.id, { question: 'x', answer: 'y' })).toBeNull();
        const [reloaded] = await manager.list(wsId, processId);
        expect(reloaded.turns).toHaveLength(MAX_TURNS_PER_SIDENOTE);
    });
});
