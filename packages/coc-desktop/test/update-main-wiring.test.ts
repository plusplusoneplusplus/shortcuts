import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Scheduling and installer behavior have Electron-free suites; these assertions
// cover the main-process composition without launching a desktop or server.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

function section(start: string, end: string): string {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    return source.slice(from, to);
}

describe('main-process auto update wiring', () => {
    const automatic = section('function startAutoUpdates()', '/** One updater');
    const manual = section('async function runUpdateCheck(', 'async function promptForUpdate(');
    const startup = section('async function recoverUpdateThenCheck()', '/** Automatic checks');
    const menu = section('function setupApplicationMenu(', 'function currentReportIssueEnvironment()');
    const quit = section("app.on('before-quit'", '// AC-01: release the global capture');

    it('uses the same process-wide coordinator for automatic and manual updates', () => {
        expect(automatic).toContain('coordinator: getUpdateCoordinator()');
        expect(source).toContain('if (updateCoordinator) return updateCoordinator;');
        expect(section('async function promptForUpdate(', '/** Surface a fatal'))
            .toContain('startUpdate: () => getUpdateCoordinator().start(release)');
    });

    it('reads the current channel and skip marker on each automatic check', () => {
        expect(automatic).toContain('check: () => checkForUpdate({');
        expect(automatic).toContain('currentVersion: app.getVersion()');
        expect(automatic).toContain('channel: getUpdateChannel(defaultDataDir(), app.getVersion())');
        expect(automatic).toContain('getSkippedVersion: () => getSkippedVersion(defaultDataDir())');
    });

    it('shares the manual check guard and releases it through the scheduler', () => {
        const guard = section('function tryBeginUpdateCheck()', 'function startAutoUpdates()');
        expect(guard).toContain('if (checkingForUpdate || isQuitting) return false;');
        expect(guard).toContain('checkingForUpdate = true;');
        expect(guard).toContain('checkingForUpdate = false;');
        expect(manual).toContain('if (!tryBeginUpdateCheck()) return;');
        expect(manual).toMatch(/finally\s*\{\s*endUpdateCheck\(\);/);
        expect(automatic).toContain('tryBeginCheck: tryBeginUpdateCheck');
        expect(automatic).toContain('endCheck: endUpdateCheck');
    });

    it('reads the current server ownership and Electron OS idle time at install checks', () => {
        expect(automatic).toContain('isIdle: () => isAppIdle({');
        expect(automatic).toContain('server: serverHandle');
        expect(automatic).toContain('getSystemIdleSeconds: () => powerMonitor.getSystemIdleTime()');
        expect(automatic).not.toContain('shutdownServer');
    });

    it('routes startup silently only when enabled, keeping the Off startup check', () => {
        expect(startup).toMatch(
            /if \(getAutoUpdateMode\(defaultDataDir\(\)\) === 'idle'\) \{\s*startAutoUpdates\(\);\s*\} else \{\s*await runUpdateCheck\(true\);/,
        );
        expect(source).toMatch(/if \(app\.isPackaged\) \{\s*void recoverUpdateThenCheck\(\);/);
        expect(automatic).toMatch(/autoUpdater\.start\(\);\s*void autoUpdater\.checkNow\(\)/);
    });

    it('persists menu choices, starts immediately when enabled and stops when disabled', () => {
        expect(menu).toContain('autoUpdateMode: getAutoUpdateMode(defaultDataDir())');
        expect(menu).toMatch(
            /onSetAutoUpdateMode: \(mode\) => \{\s*setAutoUpdateMode\(defaultDataDir\(\), mode\);\s*if \(mode === 'idle'\) \{\s*startAutoUpdates\(\);\s*\} else \{\s*autoUpdater\?\.stop\(\);\s*\}\s*setupApplicationMenu\(\);/,
        );
        expect(menu).toContain('onCheckForUpdates: () => void runUpdateCheck(false)');
    });

    it('disposes the scheduler before the existing coordinator and owned-server shutdown', () => {
        expect(automatic).toContain('if (isQuitting) return;');
        expect(quit).toMatch(/isQuitting = true;\s*autoUpdater\?\.dispose\(\);/);
        expect(quit.indexOf('autoUpdater?.dispose()')).toBeLessThan(quit.indexOf('updateCoordinator?.dispose()'));
        expect(quit).toContain("serverHandle?.started ? shutdownServer(serverHandle) : 'detached'");
    });
});
