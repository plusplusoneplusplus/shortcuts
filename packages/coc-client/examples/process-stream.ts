import { CocClient } from '@plusplusoneplusplus/coc-client';

const processId = process.argv[2];
if (!processId) {
  throw new Error('Usage: tsx examples/process-stream.ts <processId>');
}

const coc = new CocClient({ baseUrl: process.env.COC_BASE_URL ?? 'http://localhost:4000' });

const stream = coc.processes.stream(processId, {
  onEvent: event => console.log(event),
  onDone: () => console.log('stream complete'),
  onError: error => console.error(error),
});

process.on('SIGINT', () => {
  stream.close();
  process.exit(130);
});
