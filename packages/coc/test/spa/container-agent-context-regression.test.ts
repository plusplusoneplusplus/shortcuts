/**
 * Regression coverage for container agent context imports.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const CONTEXT_PATH = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'server',
    'spa',
    'client',
    'react',
    'contexts',
    'ContainerAgentContext.tsx',
);

describe('ContainerAgentContext regression', () => {
    it('does not import the reverted server-auth agent registry', () => {
        const source = fs.readFileSync(CONTEXT_PATH, 'utf-8');

        expect(source).not.toContain('setServerAuthAgents');
    });
});
