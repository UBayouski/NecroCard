// Minimal ambient types for the parts of Node the server uses. The repo has no @types/node on purpose:
// its globals would change browser types (setTimeout, Buffer) for src/. `process` is reached via globalThis.

declare module 'node:http' {
  interface Socket {
    remoteAddress?: string;
  }

  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    socket: Socket;
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    on(event: 'end' | 'close', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    resume(): this;
  }

  export interface ServerResponse {
    statusCode: number;
    headersSent: boolean;
    writeHead(status: number, headers: Record<string, string>): this;
    end(body?: string | Uint8Array): this;
  }

  export interface Server {
    listen(port: number, listener?: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    requestTimeout: number;
  }

  export function createServer(listener: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare module 'node:fs/promises' {
  export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function stat(path: string): Promise<Stats>;
  export function readFile(path: string): Promise<Uint8Array>;
}

declare module 'node:path' {
  export const sep: string;
  export function resolve(...paths: string[]): string;
  export function extname(path: string): string;
}
