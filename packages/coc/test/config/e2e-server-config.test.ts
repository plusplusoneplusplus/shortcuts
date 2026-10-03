/** Verifies the E2E boot config preserves its unrelated UI overrides. */

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

            // The per-clone header remains selected; Workspace always uses the split.
            expect(runtime.remoteShellEnabled).toBe(false);
            expect(runtime).not.toHaveProperty('splitWorkspacePanelEnabled');

            // The scope slide switcher replaces the My Work / My Life toggles and
            // the workspace identity chip in the remote-first header. It graduated
            // to default-on, so it stays pinned off here to keep the header the
            // specs target intact.
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
