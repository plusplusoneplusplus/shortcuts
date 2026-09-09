import {
    autoInstallDefaultSkills,
    autoUpdateBundledSkills,
} from '@plusplusoneplusplus/forge';
import { syncInstalledSkillsToClaude } from './claude-skill-mirror';
import { syncInstalledSkillsToCodex } from './codex-skill-mirror';

export interface StartupSkillSyncOptions {
    globalSkillsDir: string;
    defaultSkills: string[];
    autoUpdate: boolean;
    codexEnabled: boolean;
    claudeEnabled: boolean;
}

export interface StartupSkillSyncDependencies {
    updateBundled?: typeof autoUpdateBundledSkills;
    installDefaults?: typeof autoInstallDefaultSkills;
    mirrorCodex?: typeof syncInstalledSkillsToCodex;
    mirrorClaude?: typeof syncInstalledSkillsToClaude;
    log?: (message: string) => void;
}

export async function synchronizeBundledSkillsAtStartup(
    options: StartupSkillSyncOptions,
    dependencies: StartupSkillSyncDependencies = {},
): Promise<void> {
    const updateBundled = dependencies.updateBundled ?? autoUpdateBundledSkills;
    const installDefaults = dependencies.installDefaults ?? autoInstallDefaultSkills;
    const mirrorCodex = dependencies.mirrorCodex ?? syncInstalledSkillsToCodex;
    const mirrorClaude = dependencies.mirrorClaude ?? syncInstalledSkillsToClaude;
    const log = dependencies.log ?? (message => process.stderr.write(`${message}\n`));

    if (options.autoUpdate) {
        try {
            const result = await updateBundled(options.globalSkillsDir);
            for (const update of result.updated) {
                log(`[skills] Auto-updated "${update.name}" ${update.previousVersion} → ${update.newVersion}`);
            }
            for (const error of result.errors) {
                log(`[skills] Failed to update "${error.name}": ${error.error}`);
            }
        } catch {
            // Best-effort startup synchronization continues with install/mirror.
        }
    }

    if (options.defaultSkills.length > 0) {
        try {
            const result = await installDefaults(options.globalSkillsDir, options.defaultSkills);
            for (const name of result.installed) {
                log(`[skills] Auto-installed default skill "${name}"`);
            }
            for (const error of result.errors) {
                log(`[skills] Failed to install default skill "${error.name}": ${error.error}`);
            }
        } catch {
            // Provider mirrors still receive any skills already installed.
        }
    }

    const mirrors: Array<Promise<void>> = [];
    if (options.codexEnabled) {
        mirrors.push(mirrorCodex(options.globalSkillsDir).then(result => {
            if (result.synced.length > 0) {
                log(`[skills] Synced ${result.synced.length} skill(s) to Codex`);
            }
            for (const error of result.errors) {
                log(`[skills] Failed to sync "${error.name}" to Codex: ${error.error}`);
            }
        }));
    }
    if (options.claudeEnabled) {
        mirrors.push(mirrorClaude(options.globalSkillsDir).then(result => {
            if (result.synced.length > 0) {
                log(`[skills] Synced ${result.synced.length} skill(s) to Claude`);
            }
            for (const error of result.errors) {
                log(`[skills] Failed to sync "${error.name}" to Claude: ${error.error}`);
            }
        }));
    }
    await Promise.allSettled(mirrors);
}
