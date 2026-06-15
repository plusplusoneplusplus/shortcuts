/**
 * shellModel — unit tests for the pure remote-first shell helpers.
 */
import { describe, it, expect } from 'vitest';
import {
    partitionShellTabs,
    computeVisibleTabKeys,
    computeCloneStatusMap,
    cloneStatusColor,
    summarizeRemote,
    REMOTE_SCOPE_KEYS,
} from '../../../../src/server/spa/client/react/features/remote-shell/shellModel';
import type { SubTabDef } from '../../../../src/server/spa/client/react/features/repo-detail/repoSubTabs';
import type { RepoData, RepoGroup } from '../../../../src/server/spa/client/react/repos/repoGrouping';
import type { RepoSubTab } from '../../../../src/server/spa/client/react/types/dashboard';

const tab = (key: RepoSubTab, label = key): SubTabDef => ({ key, label });
const repo = (id: string, color?: string): RepoData =>
    ({ workspace: { id, name: id, color, rootPath: `/r/${id}` } } as RepoData);

describe('scope key sets', () => {
    it('declares Work Items + Pull Requests as remote-scoped', () => {
        expect([...REMOTE_SCOPE_KEYS]).toEqual(['work-items', 'pull-requests']);
    });
});

describe('partitionShellTabs', () => {
    it('splits remote-scope (stable order) from all other clone tabs (source order)', () => {
        const tabs = [
            tab('activity'), tab('cli-sessions'), tab('git'), tab('terminal'),
            tab('work-items'), tab('pull-requests'),
            tab('explorer'), tab('schedules'), tab('settings'),
        ];
        const { remote, clone } = partitionShellTabs(tabs);
        expect(remote.map(t => t.key)).toEqual(['work-items', 'pull-requests']);
        // Every non-remote tab is clone-scoped, in source order (no fixed overflow).
        expect(clone.map(t => t.key)).toEqual(['activity', 'cli-sessions', 'git', 'terminal', 'explorer', 'schedules', 'settings']);
    });

    it('omits remote tabs that are not present (e.g. non-git repo)', () => {
        const { remote, clone } = partitionShellTabs([tab('activity'), tab('work-items'), tab('explorer')]);
        expect(remote.map(t => t.key)).toEqual(['work-items']);
        expect(clone.map(t => t.key)).toEqual(['activity', 'explorer']);
    });

    it('preserves relabeled tab definitions in the remote bucket', () => {
        const { remote } = partitionShellTabs([tab('work-items', 'Work Items'), tab('pull-requests', 'Full Requests')]);
        expect(remote.map(t => t.label)).toEqual(['Work Items', 'Full Requests']);
    });
});

describe('computeVisibleTabKeys', () => {
    const m = (key: string, width: number) => ({ key, width });

    it('returns null (show all) when there is no layout width', () => {
        expect(computeVisibleTabKeys([m('a', 50)], 0, 'a')).toBeNull();
    });

    it('returns null (show all) when everything fits', () => {
        expect(computeVisibleTabKeys([m('a', 40), m('b', 40)], 500, null, 0)).toBeNull();
    });

    it('keeps only the tabs that fit, in order', () => {
        const v = computeVisibleTabKeys([m('a', 40), m('b', 40), m('c', 40)], 90, null, 0);
        expect(v && [...v]).toEqual(['a', 'b']); // 40 + 40 = 80 ≤ 90; third would be 120
    });

    it('always keeps the active tab visible, swapping out the last fitting tab', () => {
        const v = computeVisibleTabKeys([m('a', 40), m('b', 40), m('c', 40)], 90, 'c', 0);
        expect(v && [...v].sort()).toEqual(['a', 'c']);
    });

    it('accounts for the inter-tab gap', () => {
        // 40+gap(10) twice = 100 > 95 → only the first fits
        const v = computeVisibleTabKeys([m('a', 40), m('b', 40)], 95, null, 10);
        expect(v && [...v]).toEqual(['a']);
    });
});

describe('computeCloneStatusMap', () => {
    const noneHidden = () => false;

    it('classifies running / queued / paused / idle (running wins)', () => {
        const repos = [repo('a'), repo('b'), repo('c'), repo('d')];
        const map = computeCloneStatusMap(repos, {
            a: { running: [{}], queued: [{}] },
            b: { running: [], queued: [{}] },
            c: { stats: { isPaused: true }, running: [{}], queued: [] },
            // d: absent entirely
        }, noneHidden);
        expect(map).toEqual({ a: 'running', b: 'queued', c: 'paused', d: 'idle' });
    });

    it('respects the isHidden filter when counting running tasks', () => {
        const map = computeCloneStatusMap([repo('a')], { a: { running: [{ hidden: true }], queued: [] } }, (t: any) => t.hidden);
        expect(map.a).toBe('idle');
    });
});

describe('cloneStatusColor', () => {
    it('maps statuses and falls back for idle/unknown', () => {
        expect(cloneStatusColor('running', '#000')).toBe('#16a34a');
        expect(cloneStatusColor('queued', '#000')).toBe('#c98410');
        expect(cloneStatusColor('paused', '#000')).toBe('#f14c4c');
        expect(cloneStatusColor('idle', '#abc')).toBe('#abc');
        expect(cloneStatusColor(undefined, '#abc')).toBe('#abc');
    });
});

describe('summarizeRemote', () => {
    const group = (repos: RepoData[]): RepoGroup =>
        ({ normalizedUrl: 'github.com/acme/shortcuts', label: 'acme/shortcuts', repos, expanded: true });

    it('aggregates status, unseen, clone count, color and short name', () => {
        const g = group([repo('a', '#111'), repo('b', '#222'), repo('c')]);
        const s = summarizeRemote(g, { a: 'idle', b: 'queued', c: 'running' }, { a: 2, b: 0, c: 5 });
        expect(s.status).toBe('running');
        expect(s.unseen).toBe(7);
        expect(s.cloneCount).toBe(3);
        expect(s.color).toBe('#111');
        expect(s.name).toBe('shortcuts');
    });

    it('reports queued when no clone is running', () => {
        const g = group([repo('a'), repo('b')]);
        expect(summarizeRemote(g, { a: 'idle', b: 'queued' }, {}).status).toBe('queued');
    });

    it('uses the whole label as the name when there is no owner/ prefix', () => {
        const g: RepoGroup = { normalizedUrl: null, label: 'my-repo', repos: [repo('a')], expanded: true };
        expect(summarizeRemote(g, {}, {}).name).toBe('my-repo');
    });
});
