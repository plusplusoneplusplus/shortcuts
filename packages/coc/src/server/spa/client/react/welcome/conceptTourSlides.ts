export interface TourSlide {
    icon: string;
    title: string;
    description: string;
}

export const TOUR_SLIDES: TourSlide[] = [
    { icon: '💬', title: 'Ask', description: 'Ask questions about your codebase. AI reads your code and answers — no changes, no side effects.' },
    { icon: '🤖', title: 'Autopilot', description: 'Give AI a task and let it work autonomously. It uses tools, reads files, and executes multi-step plans.' },
    { icon: '📋', title: 'Generate Plan', description: 'Describe what you want built. AI produces a structured plan file with tasks, specs, and implementation steps.' },
    { icon: '📦', title: 'Queue', description: 'Every task you submit goes into a queue. Watch progress in real time, pause individual tasks, Pause All, or Pause Autopilot — cancel or re-run from one place.' },
    { icon: '🕐', title: 'Schedules', description: 'Automate recurring work with cron or interval triggers. Run daily code reviews, nightly reports, or periodic checks.' },
];
