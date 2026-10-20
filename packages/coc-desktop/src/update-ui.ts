/** Native updater dialog hooks, testable without loading Electron. */
import type { MessageBoxOptions } from 'electron';
import { DOWNLOAD_INSTALLER_LABEL, pickDownloadUrl, type ReleaseInfo, type UpdatePrompt } from './update-check';
import { validateBrowserUrl } from './browser-view-policy';

export function createUpdateDialogs(
    showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>,
    openBrowser: (url: string) => Promise<void>,
) {
    async function openDownload(url: string): Promise<void> {
        try {
            const checked = validateBrowserUrl(url);
            if (!checked.ok) {
                throw new Error('The release download URL is not a valid HTTP(S) URL.');
            }
            await openBrowser(checked.url);
        } catch (error) {
            await showMessageBox({
                type: 'error', title: 'Browser Download Failed',
                message: 'CoC could not open the installer download in your browser.',
                detail: error instanceof Error ? error.message : String(error),
                buttons: ['OK'], noLink: true,
            });
        }
    }
    return {
        openDownload,
        async promptUpdate(prompt: UpdatePrompt, actions: {
            startUpdate(): Promise<void>;
            skipVersion(version: string): void;
        }): Promise<void> {
            const { response } = await showMessageBox({
                type: 'info', title: prompt.title, message: prompt.message,
                detail: prompt.detail, buttons: prompt.buttons,
                defaultId: 0, cancelId: prompt.buttons.length - 1, noLink: true,
            });
            switch (prompt.buttons[response]) {
                case 'Update':
                    await actions.startUpdate();
                    break;
                case DOWNLOAD_INSTALLER_LABEL:
                    await openDownload(prompt.downloadUrl);
                    break;
                case 'Skip This Version':
                    actions.skipVersion(prompt.version);
                    break;
            }
        },
        async promptRestart(release: ReleaseInfo): Promise<boolean> {
            const { response } = await showMessageBox({
                type: 'info', title: 'Update Ready',
                message: `CoC ${release.version} is ready to install.`,
                detail: 'Restart CoC to install the verified update. Or download the installer in your system browser and install it yourself.',
                buttons: ['Restart to update', 'Later', DOWNLOAD_INSTALLER_LABEL],
                defaultId: 0, cancelId: 1, noLink: true,
            });
            if (response === 2) {
                await openDownload(pickDownloadUrl(release, process.platform));
            }
            return response === 0;
        },
        async confirmRunningTasks(count: number): Promise<boolean> {
            const { response } = await showMessageBox({
                type: 'warning', title: 'Running Tasks',
                message: `${count} running ${count === 1 ? 'task' : 'tasks'} will be interrupted.`,
                detail: 'Restarting stops the server started by CoC across all workspaces. Continue?',
                buttons: ['Restart to update', 'Cancel'],
                defaultId: 1, cancelId: 1, noLink: true,
            });
            return response === 0;
        },
        async promptError(reason: string): Promise<boolean> {
            const { response } = await showMessageBox({
                type: 'error', title: 'Update Failed',
                message: 'CoC could not install the update.', detail: reason,
                buttons: [DOWNLOAD_INSTALLER_LABEL, 'Later'],
                defaultId: 0, cancelId: 1, noLink: true,
            });
            return response === 0;
        },
    };
}
