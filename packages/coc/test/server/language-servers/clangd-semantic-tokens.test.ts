/**
 * Real clangd semantic tokens, decoded the way the dashboard decodes them:
 * for a workspace document over a session, and for a header outside the
 * workspace through the bridge's external-source capability.
 *
 * Runtime prerequisite: `clangd` on PATH or in a platform LLVM install location
 * (see `resolveClangdRuntime`). Without it the suite is skipped; set
 * `COC_REQUIRE_CLANGD=1` to turn a missing runtime into a failure.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepareDefinitionForRoot } from '../../../src/server/language-servers/adapters';
import { resolveClangdRuntime } from '../../../src/server/language-servers/clangd-adapter';
import { CLANGD_PRESET } from '../../../src/server/language-servers/presets';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import { LanguageServerManager } from '../../../src/server/language-servers/manager';
import { writeLanguageServerConfig } from '../../../src/server/language-servers/repository';
import { parseExternalResourceUri } from '../../../src/server/language-servers/uri-mapping';
import { LanguageServerWebSocketServer } from '../../../src/server/language-servers/ws-bridge';
import { attachWebSocketUpgradeHandler, ProcessWebSocketServer } from '../../../src/server/streaming/websocket';
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

function tokenAt(tokens: DecodedToken[], marker: string, occurrence = 0, text = SOURCE): DecodedToken | undefined {
    let index = -1;
    for (let seen = 0; seen <= occurrence; seen += 1) {
        index = text.indexOf(marker, index + 1);
    }
    const before = text.slice(0, index);
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

const HEADER = `#pragma once
namespace gear {
class Sprocket {
public:
    int teeth() const { return count; }
private:
    int count = 12;
};
}
`;
const MAIN = `#include "sprocket.hpp"

int spin() {
    gear::Sprocket wheel;
    return wheel.teeth();
}
`;

describeWithClangd('real clangd semantic tokens for an external header', () => {
    const WORKSPACE_ID = 'ws-clangd-external';
    const dirs: string[] = [];
    let manager: LanguageServerManager;
    let bridge: LanguageServerWebSocketServer;
    let server: http.Server;
    let socket: WebSocket;
    const received: any[] = [];

    function next(type: string, match: (message: any) => boolean = () => true, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const poll = () => {
                const found = received.find(message => message.type === type && match(message));
                if (found) return resolve(found);
                if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${type}`));
                setTimeout(poll, 25);
            };
            poll();
        });
    }

    beforeAll(async () => {
        const tmp = fs.realpathSync.native(os.tmpdir());
        const dataDir = fs.mkdtempSync(path.join(tmp, 'coc-lsp-clangd-ext-data-'));
        const workspace = fs.mkdtempSync(path.join(tmp, 'coc-lsp-clangd-ext-repo-'));
        const external = fs.mkdtempSync(path.join(tmp, 'coc-lsp-clangd-ext-include-'));
        dirs.push(dataDir, workspace, external);
        fs.writeFileSync(path.join(workspace, '.clangd'), '{}\n');
        fs.writeFileSync(path.join(workspace, 'main.cpp'), MAIN);
        fs.writeFileSync(path.join(external, 'sprocket.hpp'), HEADER);
        expect(writeLanguageServerConfig(dataDir, WORKSPACE_ID, {
            enabled: true,
            definitions: [{
                ...CLANGD_PRESET,
                enabled: true,
                initializationOptions: { fallbackFlags: ['-std=c++17', `-I${external}`] },
            }],
        }).ok).toBe(true);
        manager = new LanguageServerManager({ dataDir, startTimeoutMs: 45_000, requestTimeoutMs: REQUEST_TIMEOUT_MS });
        bridge = new LanguageServerWebSocketServer({
            getWorkspaces: async () => [{ id: WORKSPACE_ID, rootPath: workspace }],
        }, manager);
        server = http.createServer();
        attachWebSocketUpgradeHandler(server, new ProcessWebSocketServer(), undefined, bridge);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port;
        socket = new WebSocket(
            `ws://127.0.0.1:${port}/ws/language-server?workspaceId=${WORKSPACE_ID}&editingSessionId=clangd-ext`,
        );
        socket.on('message', raw => received.push(JSON.parse(raw.toString())));
        await new Promise<void>((resolve, reject) => {
            socket.once('open', () => resolve());
            socket.once('error', reject);
        });
    }, 60_000);

    afterAll(async () => {
        socket?.close();
        bridge?.closeAll();
        await manager?.dispose();
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        for (const dir of dirs) {
            await safeRm(dir);
        }
    });

    it('colors the header a definition led to, through the capability only', async () => {
        socket.send(JSON.stringify({ type: 'lsp-attach', requestId: 'a1', path: 'main.cpp' }));
        await next('lsp-attached', message => message.requestId === 'a1' && message.complete, 60_000);
        const attached = await next(
            'lsp-attached',
            message => message.requestId === 'a1' && message.definitionId === CLANGD_PRESET.id,
        );
        const ready = await next(
            'lsp-status',
            message => message.sessionKey === attached.sessionKey && message.state.status === 'ready',
            60_000,
        ).catch(() => attached);
        socket.send(JSON.stringify({
            type: 'lsp-notify',
            attachmentId: attached.attachmentId,
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: attached.documentUri, languageId: 'cpp', version: 1, text: MAIN } },
        }));
        const usage = MAIN.indexOf('Sprocket');
        const before = MAIN.slice(0, usage);
        socket.send(JSON.stringify({
            type: 'lsp-request',
            attachmentId: attached.attachmentId,
            id: 'def',
            method: 'textDocument/definition',
            params: {
                textDocument: { uri: attached.documentUri },
                position: { line: before.split('\n').length - 1, character: usage - (before.lastIndexOf('\n') + 1) },
            },
        }));
        const definition = await next('lsp-response', message => message.id === 'def');
        const locations = (Array.isArray(definition.result) ? definition.result : [definition.result]) as { uri?: string; targetUri?: string }[];
        const resource = parseExternalResourceUri(locations[0].uri ?? locations[0].targetUri ?? '');
        expect(resource?.displayName).toBe('sprocket.hpp');

        socket.send(JSON.stringify({
            type: 'lsp-external-semantic-tokens',
            requestId: 't1',
            attachmentId: attached.attachmentId,
            resourceId: resource!.resourceId,
        }));
        const result = await next('lsp-external-semantic-tokens-result', message => message.requestId === 't1');
        expect(result.error).toBeUndefined();
        const support = readSemanticTokensSupport(ready.state);
        expect(support).not.toBeNull();
        const tokens = decode(translateSemanticTokens(result.data, support!.legend)!);

        expect(tokenAt(tokens, 'Sprocket', 0, HEADER)?.type).toBe('lsp.class');
        expect(tokenAt(tokens, 'teeth', 0, HEADER)?.type).toBe('lsp.method');
        expect(tokenAt(tokens, 'gear', 0, HEADER)?.type).toBe('lsp.namespace');
        // The host path never crossed the socket.
        expect(JSON.stringify(received)).not.toContain('coc-lsp-clangd-ext-include-');
    }, REQUEST_TIMEOUT_MS * 2);
});

