import { createContext, useContext } from 'react';

/**
 * Collapsed-rail node that the docked `StatusActions` footer portals its Admin
 * and quota shortcuts into. `SplitWorkspacePanel` provides it only while its
 * rail is collapsed and `features.railStatusActions` is on, so the shortcuts
 * reuse the footer's actions and single quota hook instead of fetching again.
 */
export const RailStatusSlotContext = createContext<HTMLElement | null>(null);

export function useRailStatusSlot(): HTMLElement | null {
    return useContext(RailStatusSlotContext);
}
