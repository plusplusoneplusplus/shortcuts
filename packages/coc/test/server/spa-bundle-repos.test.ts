/**
 * SPA Dashboard Tests — React repos components + repos HTML structure.
 * repos.ts has been replaced by React components in react/repos/.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getClientBundle, generateDashboardHtml } from './spa-test-helpers';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'server', 'spa', 'client');

function readClientFile(name: string): string {
    return fs.readFileSync(path.join(CLIENT_DIR, name), 'utf8');
}

// ============================================================================
// React repos components exist
// ============================================================================

describe('React repos component files', () => {
    const reposDir = path.join(CLIENT_DIR, 'react', 'repos');

    const expectedFiles = [
        'repoGrouping.ts',
        'RepoCard.tsx',
        'AddRepoDialog.tsx',
        'RepoInfoTab.tsx',
        'PipelinesTab.tsx',
        'RepoQueueTab.tsx',
        'TasksStub.tsx',
        'RepoDetail.tsx',
        'ReposGrid.tsx',
        'ReposView.tsx',
        'index.ts',
    ];

    for (const file of expectedFiles) {
        it(`should have react/repos/${file}`, () => {
            expect(fs.existsSync(path.join(reposDir, file))).toBe(true);
        });
    }
});

// ============================================================================
// React repos — repoGrouping.ts source structure
// ============================================================================

describe('react/repos/repoGrouping.ts', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('react/repos/repoGrouping.ts'); });

    it('exports normalizeRemoteUrl', () => {
        expect(content).toContain('export function normalizeRemoteUrl');
    });

    it('exports remoteUrlLabel', () => {
        expect(content).toContain('export function remoteUrlLabel');
    });

    it('exports groupReposByRemote', () => {
        expect(content).toContain('export function groupReposByRemote');
    });

    it('exports hashString', () => {
        expect(content).toContain('export function hashString');
    });

    it('exports countTasks', () => {
        expect(content).toContain('export function countTasks');
    });

    it('exports truncatePath', () => {
        expect(content).toContain('export function truncatePath');
    });

    it('exports RepoData interface', () => {
        expect(content).toContain('export interface RepoData');
    });

    it('exports RepoGroup interface', () => {
        expect(content).toContain('export interface RepoGroup');
    });

    it('normalizes SSH shorthand URLs', () => {
        expect(content).toContain('sshMatch');
    });

    it('strips .git suffix during normalization', () => {
        expect(content).toContain('.git');
    });

    it('sorts multi-clone groups first', () => {
        expect(content).toContain('multiClone');
    });
});

// ============================================================================
// React repos — Router imports ReposView
// ============================================================================

describe('React Router — repos routing', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('react/layout/Router.tsx'); });

    it('imports ReposView from repos module', () => {
        expect(content).toContain("from '../repos'");
    });

    it('renders ReposView for repos tab', () => {
        expect(content).toContain('<ReposView');
    });

    it('no longer has repos stub', () => {
        expect(content).not.toContain("label=\"Repos\"");
    });

    it('parses repo deep links from hash', () => {
        expect(content).toContain('SET_SELECTED_REPO');
        expect(content).toContain('SET_REPO_SUB_TAB');
    });
});

// ============================================================================
// React repos — ReposView source structure
// ============================================================================

describe('react/repos/ReposView.tsx', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('react/repos/ReposView.tsx'); });

    it('renders a two-pane layout', () => {
        expect(content).toContain('view-repos');
        expect(content).toContain('<aside');
        expect(content).toContain('<main');
    });

    it('uses ReposGrid and RepoDetail', () => {
        expect(content).toContain('<ReposGrid');
        expect(content).toContain('<RepoDetail');
    });

    it('fetches workspaces and enriches data', () => {
        expect(content).toContain('/workspaces');
        expect(content).toContain('git-info');
        expect(content).toContain('/processes');
    });
});

// ============================================================================
// React repos — RepoDetail source structure
// ============================================================================

describe('react/repos/RepoDetail.tsx', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('react/repos/RepoDetail.tsx'); });

    it('renders sub-tab bar with all four tabs', () => {
        expect(content).toContain("'info'");
        expect(content).toContain("'pipelines'");
        expect(content).toContain("'tasks'");
        expect(content).toContain("'queue'");
    });

    it('renders Edit and Remove buttons', () => {
        expect(content).toContain('Edit');
        expect(content).toContain('Remove');
    });

    it('handles repo removal with confirmation', () => {
        expect(content).toContain('confirm(');
        expect(content).toContain('DELETE');
    });
});

// ============================================================================
// React repos — AddRepoDialog source structure
// ============================================================================

describe('react/repos/AddRepoDialog.tsx', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('react/repos/AddRepoDialog.tsx'); });

    it('supports add and edit modes', () => {
        expect(content).toContain('Add Repository');
        expect(content).toContain('Edit Repository');
    });

    it('includes filesystem browser', () => {
        expect(content).toContain('/fs/browse');
        expect(content).toContain('Browse');
    });

    it('validates path input', () => {
        expect(content).toContain('Path is required');
    });

    it('detects clone siblings', () => {
        expect(content).toContain('Clone detected');
    });

    it('renders color palette', () => {
        expect(content).toContain('#0078d4');
        expect(content).toContain('#107c10');
        expect(content).toContain('#848484');
    });
});

// ============================================================================
// React repos — RepoQueueTab source structure
// ============================================================================

describe('react/repos/RepoQueueTab.tsx', () => {
    let content: string;
    beforeAll(() => { content = readClientFile('react/repos/RepoQueueTab.tsx'); });

    it('fetches workspace-scoped queue', () => {
        expect(content).toContain('/queue?repoId=');
    });

    it('renders queue sections', () => {
        expect(content).toContain('Running Tasks');
        expect(content).toContain('Queued Tasks');
        expect(content).toContain('Completed Tasks');
    });

    it('supports cancel, move-up, move-to-top actions', () => {
        expect(content).toContain('/cancel');
        expect(content).toContain('/move-up');
        expect(content).toContain('/move-to-top');
    });

    it('renders empty state when no queue tasks', () => {
        expect(content).toContain('No tasks in queue for this repository');
    });
});

// ============================================================================
// Legacy repos.ts is deleted
// ============================================================================

describe('legacy repos.ts removal', () => {
    it('repos.ts no longer exists', () => {
        expect(fs.existsSync(path.join(CLIENT_DIR, 'repos.ts'))).toBe(false);
    });

    it('index.tsx does not import repos.ts', () => {
        const indexContent = readClientFile('index.tsx');
        expect(indexContent).not.toContain("import './repos'");
    });

    it('websocket.ts does not import from repos.ts', () => {
        const wsContent = readClientFile('websocket.ts');
        expect(wsContent).not.toContain("from './repos'");
    });
});

// ============================================================================
// Client bundle includes React repos components
// ============================================================================

describe('client bundle — React repos components', () => {
    let script: string;
    beforeAll(() => { script = getClientBundle(); });

    it('bundle contains normalizeRemoteUrl logic', () => {
        expect(script).toContain('normalizeRemoteUrl');
    });

    it('bundle contains groupReposByRemote logic', () => {
        expect(script).toContain('groupReposByRemote');
    });

    it('bundle contains hashString logic', () => {
        expect(script).toContain('hashString');
    });

    it('bundle contains ReposView component', () => {
        expect(script).toContain('view-repos');
    });

    it('bundle contains queue tab functionality', () => {
        expect(script).toContain('No tasks in queue for this repository');
    });

    it('bundle contains add repo dialog', () => {
        expect(script).toContain('Add Repository');
    });

    it('bundle contains tasks stub', () => {
        expect(script).toContain('Tasks coming in commit 007');
    });
});
