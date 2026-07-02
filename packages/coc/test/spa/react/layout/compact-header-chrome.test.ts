/**
 * Compact header rows — locks the two-row chrome dimensions defined by the
 * "Compact Header Rows" spec.
 *
 * These are source-mirror assertions (like RepoDetail-mobile.test.ts): the
 * classic-mode header lives deep inside RepoDetail and is expensive to render,
 * and the combined-chrome budget spans two files, so we assert the height
 * tokens directly at the source and compute the invariant from them.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const reactDir = path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react');
const read = (...p: string[]) => fs.readFileSync(path.join(reactDir, ...p), 'utf-8');

const TOPBAR_SOURCE = read('layout', 'TopBar.tsx');
const REMOTE_SUB_BAR_SOURCE = read('features', 'remote-shell', 'RemoteSubBar.tsx');
const REPO_DETAIL_SOURCE = read('features', 'repo-detail', 'RepoDetail.tsx');

// Tailwind `h-10` = 2.5rem = 40px. The desktop header collapses md:h-12 → md:h-10.
const HEADER_DESKTOP_PX = 40;

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

describe('compact header rows: RemoteSubBar (row 2)', () => {
    it('container shrinks to 32px', () => {
        expect(REMOTE_SUB_BAR_SOURCE).toContain('gap-0.5 h-[32px] flex-shrink-0');
        expect(REMOTE_SUB_BAR_SOURCE).not.toContain('h-[42px]');
    });

    it('tabs / clone-switch / overflow are 26px (old 30px gone)', () => {
        expect(REMOTE_SUB_BAR_SOURCE).toContain('h-[26px]');
        expect(REMOTE_SUB_BAR_SOURCE).not.toContain('h-[30px]');
    });

    it('Ask / Queue actions are 24px (old 28px gone)', () => {
        expect(REMOTE_SUB_BAR_SOURCE).toContain('h-[24px]');
        expect(REMOTE_SUB_BAR_SOURCE).not.toContain('h-[28px]');
    });

    it('scope divider scales down to 18px', () => {
        expect(REMOTE_SUB_BAR_SOURCE).toContain('h-[18px]');
        expect(REMOTE_SUB_BAR_SOURCE).not.toContain('h-[22px]');
    });
});

describe('compact header rows: classic-mode header (RepoDetail)', () => {
    it('header container shrinks to 32px to match RemoteSubBar', () => {
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

describe('compact header rows: combined chrome budget', () => {
    it('desktop header + sub-bar is ≤ 72px', () => {
        const m = REMOTE_SUB_BAR_SOURCE.match(/gap-0\.5 h-\[(\d+)px\] flex-shrink-0/);
        expect(m).not.toBeNull();
        const subBarPx = Number(m![1]);
        expect(HEADER_DESKTOP_PX + subBarPx).toBeLessThanOrEqual(72);
    });
});
