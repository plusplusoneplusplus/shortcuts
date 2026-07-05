/**
 * Compact header rows — locks the compact chrome dimensions defined by the
 * "Compact Header Rows" spec.
 *
 * These are source-mirror assertions (like RepoDetail-mobile.test.ts): the
 * classic-mode header lives deep inside RepoDetail and is expensive to render,
 * so we assert the height tokens directly at the source.
 *
 * The remote-first shell is now a single 40px header row (RemoteShellHeader in
 * the global TopBar); the old two-row RemoteSubBar and its combined-budget
 * invariant were removed with the two-row layout.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const reactDir = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const read = (...p: string[]) => fs.readFileSync(path.join(reactDir, ...p), 'utf-8');

const TOPBAR_SOURCE = read('layout', 'TopBar.tsx');
const REPO_DETAIL_SOURCE = read('features', 'repo-detail', 'RepoDetail.tsx');

describe('compact header rows: TopBar (row 1)', () => {
    it('desktop header is md:h-10 and no longer md:h-12', () => {
        expect(TOPBAR_SOURCE).toContain('h-10 md:h-10');
        expect(TOPBAR_SOURCE).not.toContain('md:h-12');
    });

    it('icon buttons drop the md: up-size (no md:h-8 md:w-8 left)', () => {
        expect(TOPBAR_SOURCE).not.toContain('md:h-8 md:w-8');
        expect(TOPBAR_SOURCE).toContain('h-7 w-7');
    });
});

describe('compact header rows: classic-mode header (RepoDetail)', () => {
    it('header container shrinks to 32px', () => {
        expect(REPO_DETAIL_SOURCE).toContain('minHeight: 32');
        expect(REPO_DETAIL_SOURCE).not.toContain('minHeight: 44');
    });

    it('sub-tabs shrink to min-h-[26px]', () => {
        expect(REPO_DETAIL_SOURCE).toContain('min-h-[26px]');
        expect(REPO_DETAIL_SOURCE).not.toContain('min-h-[32px]');
    });

    it('action buttons + overflow toggle shrink to 26px (old 30px gone)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('!h-[26px]');
        expect(REPO_DETAIL_SOURCE).toContain('h-[26px] w-[31px]');
        expect(REPO_DETAIL_SOURCE).not.toContain('!h-[30px]');
        expect(REPO_DETAIL_SOURCE).not.toContain('h-[30px] w-[31px]');
    });

    it('active-tab underline offset moves in so it stays inside the shorter bar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('-bottom-[2px]');
        expect(REPO_DETAIL_SOURCE).not.toContain('-bottom-[5px]');
    });
});
