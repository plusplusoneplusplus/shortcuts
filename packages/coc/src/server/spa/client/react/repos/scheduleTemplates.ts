/** Static schedule template data. */

interface ScheduleTemplateParam {
    key: string;
    placeholder: string;
    type?: 'text' | 'pipeline-select';
}

export interface ScheduleTemplate {
    id: string;
    label: string;
    emoji: string;
    name: string;
    target: string;
    targetType?: 'prompt' | 'script';
    cronExpr: string;
    intervalValue: string;
    intervalUnit: string;
    mode: 'cron' | 'interval';
    params: ScheduleTemplateParam[];
    hint: string;
}

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
    {
        id: 'run-workflow',
        label: 'Run workflow',
        emoji: '🚀',
        name: 'Run Workflow',
        target: 'pipelines/my-pipeline/pipeline.yaml',
        cronExpr: '0 9 * * *',
        intervalValue: '1',
        intervalUnit: 'days',
        mode: 'cron',
        params: [],
        hint: 'Ensure the workflow YAML file exists at the specified target path',
    },
    {
        id: 'run-script',
        label: 'Run Script',
        emoji: '🖥️',
        name: 'Script Runner',
        target: '',
        targetType: 'script',
        cronExpr: '0 * * * *',
        intervalValue: '1',
        intervalUnit: 'hours',
        mode: 'cron',
        params: [
            { key: 'workingDirectory', placeholder: '.' },
        ],
        hint: 'Enter a shell command or path to a script to execute on the schedule.',
    },
    {
        id: 'auto-commit',
        label: 'Auto-commit directory',
        emoji: '💾',
        name: 'Auto-commit',
        target: '.vscode/schedules/auto-commit.md',
        cronExpr: '0 * * * *',
        intervalValue: '1',
        intervalUnit: 'hours',
        mode: 'interval',
        params: [
            { key: 'directory', placeholder: './src' },
            { key: 'message', placeholder: 'chore: auto-save' },
        ],
        hint: 'Target file must exist at .vscode/schedules/auto-commit.md',
    },
    {
        id: 'pull-sync',
        label: 'Pull & sync',
        emoji: '🔄',
        name: 'Pull & Sync',
        target: '.vscode/schedules/pull-sync.md',
        cronExpr: '*/30 * * * *',
        intervalValue: '30',
        intervalUnit: 'minutes',
        mode: 'interval',
        params: [
            { key: 'directory', placeholder: '.' },
        ],
        hint: 'Target file must exist at .vscode/schedules/pull-sync.md',
    },
    {
        id: 'clean-outputs',
        label: 'Clean old outputs',
        emoji: '🧹',
        name: 'Clean Old Outputs',
        target: '.vscode/schedules/clean-outputs.md',
        cronExpr: '0 0 * * 0',
        intervalValue: '7',
        intervalUnit: 'days',
        mode: 'cron',
        params: [
            { key: 'directory', placeholder: './dist' },
            { key: 'maxAgeDays', placeholder: '7' },
        ],
        hint: 'Target file must exist at .vscode/schedules/clean-outputs.md',
    },
];
