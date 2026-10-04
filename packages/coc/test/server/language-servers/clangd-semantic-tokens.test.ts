/**
 * Real clangd semantic tokens, decoded the way the dashboard decodes them.
 *
 * Runtime prerequisite: `clangd` on PATH or in a platform LLVM install location
 * (see `resolveClangdRuntime`). Without it the suite is skipped; set
 * `COC_REQUIRE_CLANGD=1` to turn a missing runtime into a failure.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { resolveClangdRuntime } from '../../../src/server/language-servers/clangd-adapter';
import { CLANGD_PRESET } from '../../../src/server/language-servers/presets';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import {
    COC_SEMANTIC_TOKENS_LEGEND,
    readSemanticTokensSupport,
    translateSemanticTokens,
} from '../../../src/server/spa/client/react/features/language-servers/semanticTokens';
import { safeRm } from '../../helpers/safe-rm';

const SOURCE = `class Widget {
public:
    int measure() const { return size; }
private:
    int size = 3;
};

int run() {
    Widget gadget;
    return gadget.measure();
}
`;
const REQUEST_TIMEOUT_MS = CLANGD_PRESET.requestTimeoutMs ?? 120_000;
const runtime = resolveClangdRuntime(CLANGD_PRESET);
if (runtime.origin === 'unavailable' && process.env.COC_REQUIRE_CLANGD === '1') {
    throw new Error('COC_REQUIRE_CLANGD=1 but clangd was not found');
}
const describeWithClangd = runtime.origin === 'unavailable' ? describe.skip : describe;

interface DecodedToken {
    line: number;
    character: number;
    length: number;
    type: string;
    modifiers: string[];
}

function decode(data: Uint32Array): DecodedToken[] {
    const tokens: DecodedToken[] = [];
    let line = 0;
    let character = 0;
    for (let offset = 0; offset < data.length; offset += 5) {
        line += data[offset];
        character = data[offset] === 0 ? character + data[offset + 1] : data[offset + 1];
        tokens.push({
            line,
            character,
            length: data[offset + 2],
            type: COC_SEMANTIC_TOKENS_LEGEND.tokenTypes[data[offset + 3]],
            modifiers: COC_SEMANTIC_TOKENS_LEGEND.tokenModifiers.filter((_, bit) => (data[offset + 4] >> bit) & 1),
        });
    }
    return tokens;
}

function tokenAt(tokens: DecodedToken[], marker: string, occurrence = 0): DecodedToken | undefined {
    let index = -1;
    for (let seen = 0; seen <= occurrence; seen += 1) {
        index = SOURCE.indexOf(marker, index + 1);
    }
    const before = SOURCE.slice(0, index);
    const line = before.split('\n').length - 1;
    const character = index - (before.lastIndexOf('\n') + 1);
    return tokens.find(token => token.line === line && token.character === character);
}

let root: string;
let session: LanguageServerSession;

describeWithClangd('real clangd semantic tokens', () => {
    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'coc-lsp-clangd-tokens-'));
        fs.writeFileSync(path.join(root, '.clangd'), '{}\n');
        fs.writeFileSync(path.join(root, 'widget.cpp'), SOURCE);
        const prepared = prepareDefinitionForRoot({
            ...CLANGD_PRESET,
            enabled: true,
            initializationOptions: { fallbackFlags: ['-std=c++17'] },
        }, root);
        session = new LanguageServerSession({
            definition: prepared.definition,
            rootPath: root,
            runtimeLabel: prepared.runtimeLabel,
            commandLabel: prepared.commandLabel,
            startTimeoutMs: 45_000,
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            idleTimeoutMs: 10 * 60_000,
        });
        await session.start();
        session.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri: pathToFileURL(path.join(root, 'widget.cpp')).href,
                languageId: 'cpp',
                version: 1,
                text: SOURCE,
            },
        });
    }, 60_000);

    afterAll(async () => {
        await session?.dispose();
        if (root) {
            await safeRm(root);
        }
    });

    it('colors the class, its method and a variable through the CoC legend', async () => {
        const support = readSemanticTokensSupport(session.getState());
        expect(support).not.toBeNull();
        expect(support!.full).toBe(true);

        const result = await session.sendRequest('textDocument/semanticTokens/full', {
            textDocument: { uri: pathToFileURL(path.join(root, 'widget.cpp')).href },
        }) as { data?: unknown };
        const data = translateSemanticTokens(result?.data, support!.legend);
        expect(data).not.toBeNull();
        const tokens = decode(data!);

        expect(tokenAt(tokens, 'Widget')?.type).toBe('lsp.class');
        expect(tokenAt(tokens, 'Widget', 1)?.type).toBe('lsp.class');
        expect(tokenAt(tokens, 'measure')?.type).toBe('lsp.method');
        expect(tokenAt(tokens, 'gadget')?.type).toBe('lsp.variable');
        expect(tokenAt(tokens, 'size')?.type).toBe('lsp.property');
        // `int` and `return` are keywords: left to the syntax colors.
        expect(tokenAt(tokens, 'int')).toBeUndefined();
    }, REQUEST_TIMEOUT_MS + 30_000);
});
