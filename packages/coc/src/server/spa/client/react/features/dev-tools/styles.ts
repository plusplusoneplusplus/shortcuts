/**
 * The Tailwind light/dark class pairs shared by every Dev Tools card, kept in
 * one place so the cards stay visually consistent with the rest of the
 * dashboard (same palette as the workspace dock and admin surfaces).
 */

export const inputClass =
    'h-8 px-2 rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#848484] focus:outline-none focus:border-[#0078d4]';

export const textareaClass =
    'w-full min-h-[72px] px-2 py-1 rounded border border-[#d0d7de] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#848484] focus:outline-none focus:border-[#0078d4]';

export const readoutClass =
    'flex-1 min-w-0 px-2 py-1 rounded bg-[#f6f8fa] dark:bg-[#252526] text-xs font-mono text-[#1e1e1e] dark:text-[#cccccc] break-all whitespace-pre-wrap';

export const labelClass = 'flex items-center gap-1 text-[11px] text-[#656d76] dark:text-[#999]';

export const mutedClass = 'text-[11px] text-[#656d76] dark:text-[#999]';

export const errorClass = 'text-xs text-[#cf222e] dark:text-[#f85149]';

export const cardBodyClass = 'flex flex-col gap-3 pt-2';
