/**
 * Shared types for the Dev Tools panel.
 *
 * Each tool is a self-contained card: pure client-side, no server routes and no
 * network access. Tools register themselves in `registry.tsx`; the panel only
 * knows about this shape.
 */

import type { ComponentType } from 'react';

export interface DevTool {
    /** Stable id — used for testids and expansion state. */
    id: string;
    /** Card header text. */
    name: string;
    /** One-line description shown under the name in the header. */
    description: string;
    /** Extra terms the filter box matches against (e.g. 'b64' for base64). */
    keywords: string[];
    /** The card body. Rendered only while the card is expanded. */
    component: ComponentType;
}
