/**
 * SPA Dashboard Tests — browser bundle safety checks.
 *
 * Regression coverage: ensure browser bundle does not include Node-only dynamic
 * requires caused by importing server-side AI barrels into React components.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { getClientBundle } from './spa-test-helpers';

const CLIENT_REACT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'react');
const AI_MENU_FILE = path.join(CLIENT_REACT_DIR, 'tasks', 'comments', 'AICommandMenu.tsx');
const MARKDOWN_EDITOR_FILE = path.join(CLIENT_REACT_DIR, 'shared', 'MarkdownReviewEditor.tsx');
const AI_COMMANDS_FILE = path.join(CLIENT_REACT_DIR, 'shared', 'ai-commands.ts');

describe('SPA browser bundle safety', () => {
    it('does not contain Node built-in dynamic requires', () => {
        const bundle = getClientBundle();
        const disallowedRequires = [
            '__require("path")',
            '__require("fs")',
            '__require("os")',
            '__require("child_process")',
            '__require("http")',
            '__require("https")',
            '__require("net")',
            '__require("tls")',
        ];

        for (const disallowed of disallowedRequires) {
            expect(bundle).not.toContain(disallowed);
        }
    });

    it('uses local SPA command config instead of pipeline-core ai barrel', () => {
        const aiMenuSource = fs.readFileSync(AI_MENU_FILE, 'utf8');
        const markdownEditorSource = fs.readFileSync(MARKDOWN_EDITOR_FILE, 'utf8');

        expect(aiMenuSource).toContain('DASHBOARD_AI_COMMANDS');
        expect(markdownEditorSource).toContain('DASHBOARD_AI_COMMANDS');
        expect(aiMenuSource).not.toContain('@plusplusoneplusplus/pipeline-core/ai');
        expect(markdownEditorSource).not.toContain('@plusplusoneplusplus/pipeline-core/ai');
    });

    it('defines expected default dashboard AI commands', () => {
        const source = fs.readFileSync(AI_COMMANDS_FILE, 'utf8');

        expect(source).toContain("id: 'clarify'");
        expect(source).toContain("id: 'go-deeper'");
        expect(source).toContain("id: 'custom'");
        expect(source).toContain("label: 'Custom...'");
    });
});
