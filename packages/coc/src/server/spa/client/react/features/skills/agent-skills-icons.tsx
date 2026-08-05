import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function makeIcon(path: ReactNode, fill: 'none' | 'currentColor' = 'none') {
    return function Icon(props: IconProps) {
        const { className = 'ask-icon', ...rest } = props;
        return (
            <svg
                viewBox="0 0 24 24"
                fill={fill}
                stroke={fill === 'none' ? 'currentColor' : 'none'}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={className}
                aria-hidden
                {...rest}
            >
                {path}
            </svg>
        );
    };
}

export const AgentSkillsIcons = {
    search: makeIcon(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
    plus: makeIcon(<path d="M12 5v14M5 12h14" />),
    more: makeIcon(<><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>, 'currentColor'),
    link: makeIcon(<><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" /></>),
    file: makeIcon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>),
    clock: makeIcon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
    trash: makeIcon(<><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>),
    grip: makeIcon(<><circle cx="9" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="15" cy="18" r="1.4" /></>, 'currentColor'),
    zap: makeIcon(<path d="M13 2 4 14h7l-1 8 9-12h-7z" />),
    refresh: makeIcon(<><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></>),
    x: makeIcon(<path d="M18 6 6 18M6 6l12 12" />),
    chevron: makeIcon(<path d="m9 6 6 6-6 6" />),
};
