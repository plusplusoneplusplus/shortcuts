/** Static schedule template data. */

import { TaskDefs } from '../../../../../tasks/task-types';

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
        id: TaskDefs.runWorkflow.kind,
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
        id: TaskDefs.runScript.kind,
        label: 'Script',
        emoji: '🖥️',
        name: 'Run Script',
        target: '',
        targetType: 'script',
        cronExpr: '0 * * * *',
        intervalValue: '1',
        intervalUnit: 'hours',
        mode: 'cron',
        params: [
            { key: 'workingDirectory', placeholder: '.' },
        ],
        hint: 'Enter a prompt text or shell command to execute on the schedule.',
    },
    {
        id: 'notes-auto-commit',
        label: 'Notes auto-commit',
        emoji: '📝',
        name: 'Notes Auto-Commit',
        target: '',
        targetType: 'script',
        cronExpr: '*/30 * * * *',
        intervalValue: '30',
        intervalUnit: 'minutes',
        mode: 'interval',
        params: [],
        hint: 'Periodically commit changes in the notes git repo. Enable via the one-click button in the schedule list, or create manually here.',
    },
];
