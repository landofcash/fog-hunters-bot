import { createServer, type Server } from "node:http";
import type { Logger } from "pino";
import type { BotPoolSupervisor } from "./bot-pool-supervisor";

export function startHealthServer(input: {
  port: number;
  supervisor: BotPoolSupervisor;
  logger: Logger;
}): Server {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/healthz") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const health = input.supervisor.health();
    response.writeHead(health.healthy ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(health));
  });

  server.listen(input.port, "0.0.0.0", () => {
    input.logger.info({ port: input.port }, "Bot pool health server listening");
  });
  return server;
}

export function closeHealthServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
