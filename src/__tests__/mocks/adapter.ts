import { once } from "node:events";
import {
  createServer as createHttpServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { SERVER_CERTIFICATE, SERVER_KEY } from "../fixtures/tls.js";

export interface ReceivedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface MockAdapter {
  /** `127.0.0.1:<port>`, as `DaikinDevice.host` takes it. */
  host: string;
  /** Each request is added once its whole body has arrived. */
  received: ReceivedRequest[];
}

export interface StartMockAdapterOptions {
  /** Serve HTTPS with `SERVER_CERTIFICATE`. */
  usesHttps?: boolean;
}

const servers: Server[] = [];

/** Starts a server on a loopback port that stands in for an adapter. It
 * answers every request with `reply` as the body, or hands the response to
 * `reply`, which may leave it unanswered. Call `stopMockAdapters` after each
 * test. */
export async function startMockAdapter(
  reply: string | ((response: ServerResponse) => void),
  options: StartMockAdapterOptions = {},
): Promise<MockAdapter> {
  const received: ReceivedRequest[] = [];
  const handler = (request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      });
      if (typeof reply === "string") {
        response.end(reply);
      } else {
        reply(response);
      }
    });
  };
  const server = options.usesHttps
    ? createHttpsServer({ cert: SERVER_CERTIFICATE, key: SERVER_KEY }, handler)
    : createHttpServer(handler);
  servers.push(server);
  return { host: await listen(server), received };
}

export async function stopMockAdapters(): Promise<void> {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      server.close();
      return once(server, "close");
    }),
  );
}

/** A loopback host nothing listens on, so a connection to it is refused. */
export async function refusingHost(): Promise<string> {
  const server = createHttpServer();
  const host = await listen(server);
  server.close();
  await once(server, "close");
  return host;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}
