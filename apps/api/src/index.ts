import "dotenv/config";
import { startServer } from "./server";

startServer().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
