/**
 * Regression guard for the E2E server's boot config.
 *
 * The Playwright suite is written against the classic repo shell. When
 * `features.remoteShell` / `features.splitWorkspacePanel` graduated to
 * default-on, the E2E server — which resolves its config through the normal
 * merge-with-DEFAULT_CONFIG path — started booting the SPA into the new shell,
 * hiding the standalone Git sub-tab, moving the status cluster, and reshaping
 * navigation. Shared helpers (navigateToGitTab, the ws-status-indicator wait,
 * etc.) then hung until every affected test timed out, blowing past the
 * 15-minute job budget.
 *
 * The fixtures now pin both flags off via E2E_SERVER_CONFIG_YAML. This test
 * resolves that exact YAML through the real config path and asserts the runtime
 * flags the SPA would receive, so a future defaults change (or an accidental
 * removal of the pin) can't silently reshape the E2E layout again.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveConfig } from '../../src/config';
import { buildRuntimeFeatures } from '../../src/server/config/runtime-config-handler';
import { buildRuntimeFeatureFlags } from '../../src/config/admin-setting-definitions';
import { E2E_SERVER_CONFIG_YAML } from '../e2e/fixtures/e2e-server-config';

describe('E2E server boot config', () => {
    it('resolves the classic-shell layout the Playwright suite targets', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cfg-'));
        const configPath = path.join(dir, 'config.yaml');
        try {
            fs.writeFileSync(configPath, E2E_SERVER_CONFIG_YAML);
            const resolved = resolveConfig(configPath);
            const runtime = buildRuntimeFeatures(resolved);

            // Shell-reshaping flags must stay off so navigateToGitTab & friends
            // find the classic sub-tabs the specs click, and the status cluster
            // stays where the ws-status-indicator specs expect it.
            expect(runtime.remoteShellEnabled).toBe(false);
            expect(runtime.splitWorkspacePanelEnabled).toBe(false);

            // The scope slide switcher replaces the My Work / My Life toggles and
            // the workspace identity chip in the remote-first header. Default-off
            // today, but pinned so a future graduation can't reshape the header
            // the specs target.
            expect(runtime.scopeSwitcherEnabled).toBe(false);

            // The review chat lens reroutes unpinned commit/PR chat away from the
            // inline commit-chat-panel that commit-chat-binding.spec.ts asserts,
            // so it stays off at boot (commit-chat-lens.spec.ts re-enables it live).
            expect(runtime.commitChatLensEnabled).toBe(false);

            // The effort-tier selector graduated to default-on, but it replaces the
            // model-picker chip / model control that ai-actions.spec.ts and
            // commit-chat-lens.spec.ts assert. Pin it off so the suite keeps
            // exercising the model-picker UI it targets.
            expect(resolved.effortLevels.enabled).toBe(false);
            expect(buildRuntimeFeatureFlags(resolved).effortLevelsEnabled).toBe(false);

            // The deprecated Plans/Tasks sub-tab many specs use stays enabled.
            expect(runtime.showPlanDepTab).toBe(true);

            // The pin is a targeted override — other feature defaults (deep-merged
            // from DEFAULT_CONFIG) must survive, e.g. gitCrossCloneCherryPick.
            expect(resolved.features.gitCrossCloneCherryPick).toBe(true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
