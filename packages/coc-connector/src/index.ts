/**
 * @plusplusoneplusplus/coc-connector
 *
 * Consolidated messaging connectors. The root entry exports the core
 * connector contract and the shared command grammar; concrete providers live behind subpaths:
 *   - @plusplusoneplusplus/coc-connector/teams
 *   - @plusplusoneplusplus/coc-connector/whatsapp
 */

export * from './core';
export * from './shared/commands';
