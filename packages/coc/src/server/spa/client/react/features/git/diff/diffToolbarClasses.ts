/**
 * Hides a toolbar label when the nearest `[container-type:inline-size]`
 * ancestor is narrower than 560px. Outside such a container it never matches,
 * so the label stays visible.
 */
export const DIFF_TOOLBAR_NARROW_HIDDEN = '[@container_(max-width:559px)]:hidden';
