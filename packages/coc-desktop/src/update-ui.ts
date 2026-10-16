/** Native updater dialog hooks, testable without loading Electron. */
import type { MessageBoxOptions } from 'electron';
import type { ReleaseInfo } from './update-check';

export function createUpdateDialogs(
    showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>,
) {
    return {
        async promptRestart(release: ReleaseInfo): Promise<boolean> {
            const { response } = await showMessageBox({
                type: 'info', title: 'Update Ready',
                message: `CoC ${release.version} is ready to install.`,
                detail: 'Restart CoC to install the verified update.',
                buttons: ['Restart to update', 'Later'],
                defaultId: 0, cancelId: 1, noLink: true,
            });
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
                buttons: ['Download in browser', 'Later'],
                defaultId: 0, cancelId: 1, noLink: true,
            });
            return response === 0;
        },
    };
}
