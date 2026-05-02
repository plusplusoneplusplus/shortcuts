import { CocClient } from '@plusplusoneplusplus/coc-client';

const coc = new CocClient({ baseUrl: process.env.COC_BASE_URL ?? 'http://localhost:4000' });

const health = await coc.health.get();
console.log(`CoC status: ${health.status}`);

const workspaces = await coc.workspaces.list();
console.log(`Registered workspaces: ${workspaces.workspaces.length}`);
