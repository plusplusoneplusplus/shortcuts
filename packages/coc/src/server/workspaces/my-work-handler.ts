/**
 * My Work REST API Handler — sync and summary routes.
 *
 * Provides endpoints for syncing action items from Work IQ (via MCP)
 * and generating weekly summaries from notes + cross-repo data.
 *
 * Pure Node.js; uses only built-in modules.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import type { Route } from '../types';
import { getRepoDataPath } from '../paths';
import { MY_WORK_WORKSPACE_ID } from './my-work-workspace';

// ============================================================================
// Helpers
// ============================================================================

function getNotesRoot(dataDir: string): string {
    return getRepoDataPath(dataDir, MY_WORK_WORKSPACE_ID, 'notes');
}

function formatSyncDate(): string {
    const d = new Date();
    const month = d.toLocaleString('en-US', { month: 'short' });
    return `${month} ${d.getDate()}`;
}

function getISOWeek(date: Date): { year: number; week: number } {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
}

function getWeekDateRange(year: number, week: number): { start: string; end: string } {
    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const dayOfWeek = simple.getUTCDay();
    const isoStart = new Date(simple);
    isoStart.setUTCDate(simple.getUTCDate() - (dayOfWeek <= 4 ? dayOfWeek - 1 : dayOfWeek - 8));
    const isoEnd = new Date(isoStart);
    isoEnd.setUTCDate(isoStart.getUTCDate() + 4);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { start: fmt(isoStart), end: fmt(isoEnd) };
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerMyWorkRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {

    // ------------------------------------------------------------------
    // POST /api/my-work/sync — Sync data from Work IQ into notes
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/my-work\/sync$/,
        handler: async (req, res) => {
            try {
                const notesRoot = getNotesRoot(dataDir);
                await fs.promises.mkdir(notesRoot, { recursive: true });

                // Parse optional body with Work IQ data
                let body: any = {};
                try {
                    const chunks: Buffer[] = [];
                    for await (const chunk of req) chunks.push(chunk as Buffer);
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    if (raw.trim()) body = JSON.parse(raw);
                } catch { /* empty body is fine */ }

                const dateLabel = formatSyncDate();
                const syncHeader = `\n## Synced ${dateLabel}\n`;

                // Append action items
                const actionItemsPath = path.join(notesRoot, 'Action Items.md');
                if (body.actionItems && Array.isArray(body.actionItems) && body.actionItems.length > 0) {
                    const items = body.actionItems.map((item: string) => `- [ ] ${item}`).join('\n');
                    const section = `${syncHeader}${items}\n`;
                    await fs.promises.appendFile(actionItemsPath, section, 'utf-8');
                }

                // Append follow-ups (grouped by person)
                const followUpsPath = path.join(notesRoot, 'Follow Ups.md');
                if (body.followUps && typeof body.followUps === 'object' && Object.keys(body.followUps).length > 0) {
                    let section = syncHeader;
                    for (const [person, items] of Object.entries(body.followUps)) {
                        section += `### ${person}\n`;
                        if (Array.isArray(items)) {
                            section += items.map((item: string) => `- [ ] ${item}`).join('\n') + '\n';
                        }
                    }
                    await fs.promises.appendFile(followUpsPath, section, 'utf-8');
                }

                sendJSON(res, 200, {
                    synced: true,
                    date: dateLabel,
                    actionItemCount: body.actionItems?.length ?? 0,
                    followUpCount: body.followUps ? Object.values(body.followUps).flat().length : 0,
                });
            } catch (err: any) {
                sendError(res, 500, `Sync failed: ${err.message}`);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/my-work/generate-summary — Generate weekly summary note
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/my-work\/generate-summary$/,
        handler: async (_req, res) => {
            try {
                const notesRoot = getNotesRoot(dataDir);
                const weeklyDir = path.join(notesRoot, 'Weekly');
                await fs.promises.mkdir(weeklyDir, { recursive: true });

                // Read current notes
                const actionItemsPath = path.join(notesRoot, 'Action Items.md');
                const followUpsPath = path.join(notesRoot, 'Follow Ups.md');

                let actionItemsContent = '';
                let followUpsContent = '';
                try { actionItemsContent = await fs.promises.readFile(actionItemsPath, 'utf-8'); } catch { /* file may not exist */ }
                try { followUpsContent = await fs.promises.readFile(followUpsPath, 'utf-8'); } catch { /* file may not exist */ }

                // Parse checked/unchecked items
                const completed = [...actionItemsContent.matchAll(/- \[x\] (.+)/gi)].map(m => m[1]);
                const inProgress = [...actionItemsContent.matchAll(/- \[ \] (.+)/g)].map(m => m[1]);
                const waitingOn = [...followUpsContent.matchAll(/- \[ \] (.+)/g)].map(m => m[1]);

                // Collect cross-repo process stats
                let processStats = { completed: 0, failed: 0 };
                try {
                    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    processStats.completed = await store.getProcessCount({
                        status: 'completed',
                        since: weekAgo,
                    });
                    processStats.failed = await store.getProcessCount({
                        status: 'failed',
                        since: weekAgo,
                    });
                } catch { /* non-critical — proceed without cross-repo data */ }

                // Generate weekly file
                const now = new Date();
                const { year, week } = getISOWeek(now);
                const { start, end } = getWeekDateRange(year, week);
                const weekFile = `${year}-W${String(week).padStart(2, '0')}.md`;
                const weekPath = path.join(weeklyDir, weekFile);

                let summary = `# Week ${week} — ${start}–${end}, ${year}\n\n`;

                if (completed.length > 0) {
                    summary += `## Completed\n${completed.map(i => `- ${i}`).join('\n')}\n\n`;
                }

                if (processStats.completed > 0 || processStats.failed > 0) {
                    summary += `## AI Tasks (this week)\n`;
                    summary += `- ${processStats.completed} completed`;
                    if (processStats.failed > 0) summary += `, ${processStats.failed} failed`;
                    summary += '\n\n';
                }

                if (inProgress.length > 0) {
                    summary += `## In Progress\n${inProgress.map(i => `- ${i}`).join('\n')}\n\n`;
                }

                if (waitingOn.length > 0) {
                    summary += `## Waiting On\n${waitingOn.map(i => `- ${i}`).join('\n')}\n\n`;
                }

                summary += `## Next Week\n- (add your plans here)\n`;

                await fs.promises.writeFile(weekPath, summary, 'utf-8');

                sendJSON(res, 200, {
                    generated: true,
                    path: `Weekly/${weekFile}`,
                    completedCount: completed.length,
                    inProgressCount: inProgress.length,
                    waitingOnCount: waitingOn.length,
                });
            } catch (err: any) {
                sendError(res, 500, `Summary generation failed: ${err.message}`);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/my-work/status — Quick status for the My Work page
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/my-work\/status$/,
        handler: async (_req, res) => {
            try {
                const notesRoot = getNotesRoot(dataDir);
                const exists = fs.existsSync(path.join(notesRoot, 'Action Items.md'));
                sendJSON(res, 200, { initialized: exists, workspaceId: MY_WORK_WORKSPACE_ID });
            } catch (err: any) {
                sendError(res, 500, err.message);
            }
        },
    });
}
