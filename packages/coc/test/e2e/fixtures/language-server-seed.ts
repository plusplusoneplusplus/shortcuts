/**
 * Language support ships off. A workspace turns it on in its own settings, so a
 * spec that wants a real language server has to write that config for its own
 * server before the page loads the file.
 *
 * The helper reads `effective` (presets layered with any stored override) and
 * writes it back with every definition enabled, which is exactly what the
 * settings panel does when a user ticks the TypeScript preset. Doing it that
 * way keeps the fixture free of a second copy of the preset literal.
 */

import * as fs from 'fs';
import * as path from 'path';
import { request } from './seed';

/** One entry of the config payload; the fields are opaque to this helper. */
type Definition = Record<string, unknown>;

/** Turn language support on for one workspace. Call before `page.goto`. */
export async function enableLanguageServers(baseURL: string, workspaceId: string): Promise<void> {
    const url = `${baseURL}/api/workspaces/${encodeURIComponent(workspaceId)}/language-servers`;

    const read = await request(url);
    if (read.status !== 200) {
        throw new Error(`Failed to read language-server config: ${read.status} ${read.body}`);
    }
    const { effective } = JSON.parse(read.body) as { effective: Definition[] };
    const definitions = effective.map(definition => ({ ...definition, enabled: true }));

    const write = await request(url, {
        method: 'PUT',
        body: JSON.stringify({ enabled: true, definitions }),
    });
    if (write.status !== 200) {
        throw new Error(`Failed to enable language servers: ${write.status} ${write.body}`);
    }
}

/**
 * A small TypeScript project the language server can actually understand: a
 * `tsconfig.json` for the root marker, a module that exports a type and a
 * function, and an importer that uses both.
 *
 * `src/app.ts` is the file every case opens. It refers to `formatWidget` from
 * `src/format.ts`, so one buffer exercises hover, cross-file navigation and
 * project-wide type checking. It is free of errors and ends on an empty line,
 * which is where the diagnostics case types one.
 *
 * @returns Absolute path to the created repo directory.
 */
export function createTypeScriptRepoFixture(tmpDir: string): string {
    const repoDir = path.join(tmpDir, 'lsp-repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });

    fs.writeFileSync(
        path.join(repoDir, 'tsconfig.json'),
        JSON.stringify(
            {
                compilerOptions: {
                    target: 'ES2020',
                    module: 'CommonJS',
                    moduleResolution: 'node',
                    strict: true,
                },
                include: ['src'],
            },
            null,
            2,
        ) + '\n',
    );

    fs.writeFileSync(
        path.join(repoDir, 'src', 'format.ts'),
        [
            'export interface Widget {',
            '    name: string;',
            '    size: number;',
            '}',
            '',
            'export function formatWidget(widget: Widget): string {',
            '    return widget.name + String(widget.size);',
            '}',
            '',
        ].join('\n'),
    );

    fs.writeFileSync(
        path.join(repoDir, 'src', 'app.ts'),
        [
            "import { formatWidget } from './format';",
            '',
            "export const label = formatWidget({ name: 'gadget', size: 3 });",
            '',
        ].join('\n'),
    );

    return repoDir;
}
