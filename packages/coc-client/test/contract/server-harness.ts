import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer, type ExecutionServer } from '../../../coc/src/server';
import { createProcessStore } from '../../../coc/src/config';
import { CocClient } from '../../src';

export interface ContractHarness {
  server: ExecutionServer;
  client: CocClient;
  dataDir: string;
  close: () => Promise<void>;
}

export async function startContractHarness(): Promise<ContractHarness> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-client-contract-'));
  const store = createProcessStore(dataDir, 'sqlite');
  const server = await createExecutionServer({
    port: 0,
    host: '127.0.0.1',
    dataDir,
    store,
    queue: { autoStart: false },
    fileConfig: {
      queue: { autoStart: false },
      terminal: { enabled: false },
      skills: { autoUpdate: false, defaultSkills: [] },
    },
  } as Parameters<typeof createExecutionServer>[0]);
  const client = new CocClient({ baseUrl: server.url });

  return {
    server,
    client,
    dataDir,
    close: async () => {
      await server.close();
      (store as { close?: () => void }).close?.();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
