/**
 * Tests for ToastProvider wiring in App.tsx.
 *
 * Verifies that the App component tree includes ToastProvider so that
 * child components (FollowPromptDialog, UpdateDocumentDialog) can use
 * useGlobalToast() without crashing.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const APP_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'App.tsx');
const FOLLOW_PROMPT_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'shared', 'FollowPromptDialog.tsx');
const UPDATE_DOC_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'shared', 'UpdateDocumentDialog.tsx');

describe('ToastProvider wiring in App.tsx', () => {
    let appSource: string;

    beforeAll(() => {
        appSource = fs.readFileSync(APP_PATH, 'utf-8');
    });

    it('imports ToastProvider from context/ToastContext', () => {
        expect(appSource).toContain("import { ToastProvider } from './context/ToastContext'");
    });

    it('renders <ToastProvider> in the component tree', () => {
        expect(appSource).toContain('<ToastProvider');
    });

    it('passes addToast, removeToast, and toasts to ToastProvider value', () => {
        expect(appSource).toMatch(/addToast.*removeToast.*toasts/s);
        expect(appSource).toContain('value={{ addToast, removeToast, toasts }}');
    });

    it('destructures addToast from useToast()', () => {
        expect(appSource).toMatch(/const\s*\{[^}]*addToast[^}]*\}\s*=\s*useToast\(\)/);
    });
});

describe('FollowPromptDialog uses useGlobalToast', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(FOLLOW_PROMPT_PATH, 'utf-8');
    });

    it('imports useGlobalToast from ToastContext', () => {
        expect(source).toContain("import { useGlobalToast } from '../context/ToastContext'");
    });

    it('calls useGlobalToast() to get addToast', () => {
        expect(source).toContain('useGlobalToast()');
        expect(source).toContain('addToast');
    });
});

describe('UpdateDocumentDialog uses useGlobalToast', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(UPDATE_DOC_PATH, 'utf-8');
    });

    it('imports useGlobalToast from ToastContext', () => {
        expect(source).toContain("import { useGlobalToast } from '../context/ToastContext'");
    });

    it('calls useGlobalToast() to get addToast', () => {
        expect(source).toContain('useGlobalToast()');
        expect(source).toContain('addToast');
    });
});
