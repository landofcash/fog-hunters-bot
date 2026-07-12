import { buildApp } from "./app";
import { loadConfig } from "./lib/config";

export async function startServer(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });
  await app.listen({
    host: config.host,
    port: config.port,
  });
}
