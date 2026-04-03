/**
 * CoC Favicon Icon Template
 *
 * Generates a deterministic SVG icon for the CoC dashboard.
 * Colors are derived from the machine hostname so each machine
 * gets a unique, visually distinct icon — making it easy to tell
 * multiple open CoC tabs apart at a glance.
 *
 * Algorithm: djb2-style hash → hue1; hue2 = (hue1 + 120) % 360 (triadic pair).
 * Triadic spacing guarantees the two hues are always visually distinct.
 */

/**
 * Map a hostname string to two triadic HSL hues.
 * Returns { hue1, hue2 } in [0, 360).
 */
export function hostnameToGradient(hostname: string): { hue1: number; hue2: number } {
    let hash = 5381;
    for (let i = 0; i < hostname.length; i++) {
        hash = ((hash << 5) + hash + hostname.charCodeAt(i)) | 0; // djb2: hash * 33 + c
    }
    const hue1 = Math.abs(hash) % 360;
    const hue2 = (hue1 + 120) % 360;
    return { hue1, hue2 };
}

/**
 * Generate the CoC SVG icon with hostname-derived colors.
 *
 * @param hostname - Machine hostname; falls back to neutral blue/purple if omitted.
 */
export function generateIconSvg(hostname?: string): string {
    let color1: string;
    let color2: string;

    if (hostname) {
        const { hue1, hue2 } = hostnameToGradient(hostname);
        color1 = `hsl(${hue1},75%,65%)`;
        color2 = `hsl(${hue2},75%,65%)`;
    } else {
        // Default: GitHub Copilot blue / purple
        color1 = '#58a6ff';
        color2 = '#a371f7';
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${color1}"/>
      <stop offset="100%" stop-color="${color2}"/>
    </linearGradient>
    <linearGradient id="g2" x1="100%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${color2}"/>
      <stop offset="100%" stop-color="${color1}"/>
    </linearGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="pulse" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${color1}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${color1}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="#0d1117"/>
  <circle cx="50" cy="50" r="28" fill="url(#pulse)"/>
  <!-- Outer C: opens right -->
  <path d="M 58 15 A 35 35 0 1 0 58 85"
        fill="none" stroke="url(#g1)" stroke-width="8.5" stroke-linecap="round" filter="url(#glow)"/>
  <!-- Inner C: opens left, shifted right to clear center node -->
  <path d="M 48 30 A 20 20 0 1 1 48 70"
        fill="none" stroke="url(#g2)" stroke-width="6" stroke-linecap="round" filter="url(#glow)"/>
  <!-- Central AI spark -->
  <circle cx="50" cy="50" r="5" fill="${color1}" filter="url(#glow)"/>
  <circle cx="50" cy="50" r="9" fill="none" stroke="${color2}" stroke-width="1.2" opacity="0.45"/>
</svg>`;
}
