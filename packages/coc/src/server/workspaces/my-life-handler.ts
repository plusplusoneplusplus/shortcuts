/**
 * My Life REST API Handler — sync and summary routes.
 *
 * Provides endpoints for syncing personal items
 * and generating weekly summaries from notes.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import type { Route } from '../types';
import { getRepoDataPath } from '../paths';
import { MY_LIFE_WORKSPACE_ID } from './my-life-workspace';

import { formatSyncDate, getISOWeek, getWeekDateRange } from './date-helpers';

// ============================================================================
// Helpers
// ============================================================================

function getNotesRoot(dataDir: string): string {
    return getRepoDataPath(dataDir, MY_LIFE_WORKSPACE_ID, 'notes');
}

// ============================================================================
// Route Registration
// ============================================================================

export function registerMyLifeRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {

    // ------------------------------------------------------------------
    // POST /api/my-life/sync — Sync personal items into notes
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/my-life\/sync$/,
        handler: async (req, res) => {
            try {
                const notesRoot = getNotesRoot(dataDir);
                await fs.promises.mkdir(notesRoot, { recursive: true });

                // Parse optional body with personal data
                let body: any = {};
                try {
                    const chunks: Buffer[] = [];
                    for await (const chunk of req) chunks.push(chunk as Buffer);
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    if (raw.trim()) body = JSON.parse(raw);
                } catch { /* empty body is fine */ }

                const dateLabel = formatSyncDate();
                const syncHeader = `\n## Synced ${dateLabel}\n`;

                const goalsPath = path.join(notesRoot, 'Goals.md');
                if (body.goals && Array.isArray(body.goals) && body.goals.length > 0) {
                    const items = body.goals.map((item: string) => `- [ ] ${item}`).join('\n');
                    const section = `${syncHeader}${items}\n`;
                    await fs.promises.appendFile(goalsPath, section, 'utf-8');
                }

                const journalPath = path.join(notesRoot, 'Journal.md');
                if (body.entries && typeof body.entries === 'object' && Object.keys(body.entries).length > 0) {
                    let section = syncHeader;
                    for (const [category, items] of Object.entries(body.entries)) {
                        section += `### ${category}\n`;
                        if (Array.isArray(items)) {
                            section += items.map((item: string) => `- ${item}`).join('\n') + '\n';
                        }
                    }
                    await fs.promises.appendFile(journalPath, section, 'utf-8');
                }

                sendJSON(res, 200, {
                    synced: true,
                    date: dateLabel,
                    goalCount: body.goals?.length ?? 0,
                    entryCount: body.entries ? Object.values(body.entries).flat().length : 0,
                });
            } catch (err: any) {
                sendError(res, 500, `Sync failed: ${err.message}`);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/my-life/generate-summary — Generate weekly summary note
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/my-life\/generate-summary$/,
        handler: async (_req, res) => {
            try {
                const notesRoot = getNotesRoot(dataDir);
                const weeklyDir = path.join(notesRoot, 'Weekly');
                await fs.promises.mkdir(weeklyDir, { recursive: true });

                // Read current notes
                const goalsPath = path.join(notesRoot, 'Goals.md');
                const journalPath = path.join(notesRoot, 'Journal.md');

                let goalsContent = '';
                let journalContent = '';
                try { goalsContent = await fs.promises.readFile(goalsPath, 'utf-8'); } catch { /* file may not exist */ }
                try { journalContent = await fs.promises.readFile(journalPath, 'utf-8'); } catch { /* file may not exist */ }

                // Parse checked/unchecked items
                const completed = [...goalsContent.matchAll(/- \[x\] (.+)/gi)].map(m => m[1]);
                const inProgress = [...goalsContent.matchAll(/- \[ \] (.+)/g)].map(m => m[1]);
                const journalEntries = [...journalContent.matchAll(/- (.+)/g)].map(m => m[1]);

                // Generate weekly file
                const now = new Date();
                const { year, week } = getISOWeek(now);
                const { start, end } = getWeekDateRange(year, week);
                const weekFile = `${year}-W${String(week).padStart(2, '0')}.md`;
                const weekPath = path.join(weeklyDir, weekFile);

                let summary = `# Week ${week} — ${start}–${end}, ${year}\n\n`;

                if (completed.length > 0) {
                    summary += `## Completed Goals\n${completed.map(i => `- ${i}`).join('\n')}\n\n`;
                }

                if (inProgress.length > 0) {
                    summary += `## In Progress\n${inProgress.map(i => `- ${i}`).join('\n')}\n\n`;
                }

                if (journalEntries.length > 0) {
                    summary += `## Journal Highlights\n${journalEntries.slice(0, 10).map(i => `- ${i}`).join('\n')}\n\n`;
                }

                summary += `## Next Week\n- (add your plans here)\n`;

                await fs.promises.writeFile(weekPath, summary, 'utf-8');

                sendJSON(res, 200, {
                    generated: true,
                    path: `Weekly/${weekFile}`,
                    completedCount: completed.length,
                    inProgressCount: inProgress.length,
                    journalCount: journalEntries.length,
                });
            } catch (err: any) {
                sendError(res, 500, `Summary generation failed: ${err.message}`);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/my-life/status — Quick status for the My Life page
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/my-life\/status$/,
        handler: async (_req, res) => {
            try {
                const notesRoot = getNotesRoot(dataDir);
                const exists = fs.existsSync(path.join(notesRoot, 'Goals.md'));
                sendJSON(res, 200, { initialized: exists, workspaceId: MY_LIFE_WORKSPACE_ID });
            } catch (err: any) {
                sendError(res, 500, err.message);
            }
        },
    });
}
