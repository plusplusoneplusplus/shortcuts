/** Fixed and randomized parity between the native index and the old scanner. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { makeRandom, notesAddon } from './helpers';
import { searchNotesOracle } from './notes-index-oracle';

function write(root: string, relative: string, contents: string | Buffer): void {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

describe('native Notes search matches the test-only JavaScript oracle', () => {
    it('agrees on fixed behavior fixtures', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-fixed-parity-'));
        try {
            write(root, 'Needle.md', 'needle first\r\nother\nNEEDLE last');
            write(root, 'nested/unicode.md', 'İSTANBUL\nStraße\nCAFÉ');
            write(root, 'nested/ignored.MD', 'needle');
            write(root, 'nested/plain.txt', 'needle');
            write(root, 'bytes.md', Buffer.from('before \xff after', 'latin1'));
            const index = await notesAddon.buildNotesIndex(root, {});

            for (const query of ['needle', 'NEEDLE', 'İST', 'istanbul', 'straße', 'STRASSE', 'café', '� after', 'missing', '']) {
                expect(await index.search(query), query).toEqual(searchNotesOracle(root, query));
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it('agrees across deterministic randomized representative inputs', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-random-parity-'));
        const random = makeRandom(0x51ced);
        const tokens = ['alpha', 'Bravo', 'CAFÉ', 'Straße', 'İSTANBUL', '日本語', 'two words', 'x-y'];
        try {
            for (let file = 0; file < 80; file++) {
                const depth = file % 4;
                const folders = Array.from({ length: depth }, (_, index) => `group-${(file + index) % 7}`);
                const extension = file % 11 === 0 ? '.MD' : file % 13 === 0 ? '.txt' : '.md';
                const filename = `${tokens[file % tokens.length]}-${file}${extension}`;
                const lines = Array.from({ length: 3 + (file % 12) }, () => {
                    const left = tokens[Math.floor(random() * tokens.length)];
                    const right = tokens[Math.floor(random() * tokens.length)];
                    return `${left} ${Math.floor(random() * 10_000)} ${right}`;
                });
                write(root, [...folders, filename].join('/'), lines.join(file % 5 === 0 ? '\r\n' : '\n'));
            }

            const index = await notesAddon.buildNotesIndex(root, {});
            const queries = ['alpha', 'BRAVO', 'café', 'straße', 'STRASSE', 'İST', 'istanbul', '日本', 'two words', 'x-y', 'absent'];
            for (let iteration = 0; iteration < 100; iteration++) {
                const query = queries[Math.floor(random() * queries.length)];
                expect(await index.search(query), `iteration ${iteration}: ${query}`).toEqual(
                    searchNotesOracle(root, query),
                );
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
