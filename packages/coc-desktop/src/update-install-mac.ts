/** Electron-free macOS staging. The caller starts the helper before the normal quit drain. */
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { posix as path } from 'node:path';
import { promisify } from 'node:util';
import type { DownloadedUpdate } from './update-install';

const execFileAsync = promisify(execFile);
export interface MacInstallDependencies {
    fs: Pick<typeof fs, 'realpath' | 'access' | 'mkdtemp' | 'mkdir' | 'writeFile' | 'rm'>;
    run(file: string, args: string[]): Promise<string>;
}
const defaults: MacInstallDependencies = {
    fs,
    run: async (file, args) => (await execFileAsync(file, args, { timeout: 120_000 })).stdout,
};

/** hdiutil emits plist strings; decode only XML entities, never shell syntax. */
function imageMounts(plist: string): string[] {
    return [...plist.matchAll(/<key>mount-point<\/key>\s*<string>([^<]*)<\/string>/g)]
        .map(match => match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) =>
            ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]!));
}

export async function validateMacInstallLocation(
    appBundle: string, deps: MacInstallDependencies = defaults,
): Promise<string> {
    const bundle = await deps.fs.realpath(appBundle);
    if (!path.isAbsolute(bundle) || !bundle.endsWith('.app')) {
        throw new Error('The current app bundle location is invalid.');
    }
    if (bundle.includes('/AppTranslocation/')) {
        throw new Error('CoC is running from a translocated location. Move it to Applications first.');
    }
    const mounts = imageMounts(await deps.run('/usr/bin/hdiutil', ['info', '-plist']));
    if (mounts.some(mount => bundle === mount || bundle.startsWith(`${mount}/`))) {
        throw new Error('CoC is running from a mounted disk image. Move it to Applications first.');
    }
    try {
        await deps.fs.access(bundle, constants.W_OK);
        await deps.fs.access(path.dirname(bundle), constants.W_OK);
    } catch {
        throw new Error('The app bundle location is not writable. Move CoC to a writable location.');
    }
    return bundle;
}

/** Arguments are passed separately so bundle names cannot become shell commands. */
export const macInstallHelper = `#!/bin/sh
set -u
old_pid=$1
target=$2
stage_dir=$3
update_dir=$4
staged="$stage_dir/CoC.app"
backup="$stage_dir/previous.app"
fail() {
    printf '%s\\n' "$1" > "$update_dir/install-error.txt"
    /usr/bin/open "$target" || true
    exit 1
}
# Allow the app's normal server drain to finish; never replace a running bundle.
waited=0
while kill -0 "$old_pid" 2>/dev/null; do
    if [ "$waited" -ge 300 ]; then
        fail 'Timed out waiting for CoC to quit.'
    fi
    sleep 1
    waited=$((waited + 1))
done
/bin/mv "$target" "$backup" || fail 'Could not move the current app bundle.'
rollback() {
    /bin/rm -rf "$target"
    /bin/mv "$backup" "$target" || fail 'Update failed and the previous app could not be restored.'
    fail "$1"
}
/bin/mv "$staged" "$target" || rollback 'Could not install the staged app bundle.'
/usr/bin/xattr -r "$target" > "$update_dir/attributes.txt" || rollback 'Could not inspect app quarantine.'
if /usr/bin/grep -q 'com.apple.quarantine' "$update_dir/attributes.txt"; then
    /usr/bin/xattr -dr com.apple.quarantine "$target" || rollback 'Could not clear app quarantine.'
fi
/usr/bin/open "$target" || rollback 'Could not relaunch the updated app.'
/bin/rm -rf "$stage_dir" "$update_dir"
`;

export interface PreparedMacUpdate {
    helperPath: string;
    helperArgs: string[];
    /** Before helper launch, discard staging while retaining the verified download. */
    cleanup(): Promise<void>;
}

export async function prepareMacUpdate(options: {
    download: DownloadedUpdate;
    appBundle: string;
    oldPid: number;
    deps?: MacInstallDependencies;
}): Promise<PreparedMacUpdate> {
    const deps = options.deps ?? defaults;
    if (!Number.isSafeInteger(options.oldPid) || options.oldPid <= 0) throw new Error('Invalid app PID.');
    const bundle = await validateMacInstallLocation(options.appBundle, deps);
    // Stage on the destination filesystem so the helper can swap with atomic renames.
    const stageDir = await deps.fs.mkdtemp(path.join(path.dirname(bundle), '.coc-update-'));
    const mount = path.join(stageDir, 'image');
    const helperPath = path.join(options.download.tempDir, 'install-mac.sh');
    const cleanup = async () => {
        await deps.fs.rm(stageDir, { recursive: true, force: true });
    };
    let detached = true;
    try {
        await deps.fs.mkdir(mount);
        let mounted = false;
        try {
            detached = false;
            await deps.run('/usr/bin/hdiutil', [
                'attach', options.download.installerPath, '-readonly', '-nobrowse', '-mountpoint', mount,
            ]);
            mounted = true;
            const source = path.join(mount, 'CoC.app');
            await deps.fs.access(path.join(source, 'Contents', 'Info.plist'), constants.R_OK);
            await deps.fs.access(path.join(source, 'Contents', 'MacOS', 'CoC'), constants.X_OK);
            await deps.run('/usr/bin/ditto', [source, path.join(stageDir, 'CoC.app')]);
        } finally {
            // A failed attach can still leave a partial mount; inspect before cleanup.
            try {
                if (!mounted) {
                    mounted = imageMounts(await deps.run('/usr/bin/hdiutil', ['info', '-plist'])).includes(mount);
                }
                if (mounted) await deps.run('/usr/bin/hdiutil', ['detach', mount]);
                detached = true;
            } catch {
                throw new Error(`Could not detach the update disk image at ${mount}.`);
            }
        }
        await deps.fs.writeFile(helperPath, macInstallHelper, { mode: 0o700 });
        return {
            helperPath,
            helperArgs: [String(options.oldPid), bundle, stageDir, options.download.tempDir],
            cleanup,
        };
    } catch (error) {
        // Never recursively remove a directory that may still contain a mounted image.
        if (detached) await cleanup();
        throw error;
    }
}

/** Resolves only after spawn succeeds; the caller can then call app.quit(). */
export async function launchMacUpdate(
    prepared: PreparedMacUpdate,
    spawnFn: typeof spawn = spawn,
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawnFn('/bin/sh', [prepared.helperPath, ...prepared.helperArgs], {
            detached: true, stdio: 'ignore', cwd: '/',
        });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
    });
}
