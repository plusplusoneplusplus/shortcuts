import type {
  CherryPickTransferRequest,
  CherryPickTransferResponse,
  RemoteServer,
  RemoteServerHealth,
  RemoteServerInput,
  RemoteServerPatch,
  RemoteServerRuntime,
} from '../contracts';
import type { RequestAdapter } from '../types';

function serverPath(id: string, suffix = ''): string {
  return `/servers/${encodeURIComponent(id)}${suffix}`;
}

export class ServersClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(): Promise<RemoteServer[]> {
    return this.transport.request<RemoteServer[]>('/servers');
  }

  add(input: RemoteServerInput): Promise<RemoteServer> {
    return this.transport.request<RemoteServer>('/servers', {
      method: 'POST',
      body: input,
    });
  }

  update(id: string, patch: RemoteServerPatch): Promise<RemoteServer> {
    return this.transport.request<RemoteServer>(serverPath(id), {
      method: 'PATCH',
      body: patch,
    });
  }

  remove(id: string): Promise<void> {
    return this.transport.request<void>(serverPath(id), {
      method: 'DELETE',
    });
  }

  test(input: RemoteServerInput): Promise<RemoteServerHealth> {
    return this.transport.request<RemoteServerHealth>('/servers/test', {
      method: 'POST',
      body: input,
    });
  }

  reconnect(id: string): Promise<RemoteServerRuntime> {
    return this.transport.request<RemoteServerRuntime>(serverPath(id, '/reconnect'), {
      method: 'POST',
    });
  }

  getHealth(id: string): Promise<RemoteServerHealth> {
    return this.transport.request<RemoteServerHealth>(serverPath(id, '/health'));
  }

  cherryPickTransfer(request: CherryPickTransferRequest): Promise<CherryPickTransferResponse> {
    return this.transport.request<CherryPickTransferResponse>('/servers/cherry-pick-transfer', {
      method: 'POST',
      body: { ...request },
    });
  }
}
