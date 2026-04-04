export interface TipContent {
    title: string;
    body: string;
}

export const TIPS: Record<string, TipContent> = {
    'memory-intro': {
        title: 'AI Memory',
        body: 'Memory lets AI remember facts across sessions. Enable it per-repo in settings to help AI learn your codebase patterns.',
    },
    'skills-intro': {
        title: 'Agent Skills',
        body: 'Skills extend what AI can do. Browse the gallery to install pre-built skills, or create custom ones from GitHub repos.',
    },
    'admin-intro': {
        title: 'Dashboard Settings',
        body: 'Configure AI providers, manage data exports, and customize system prompts from here.',
    },
};
