import { loadConfig } from "./config";
import { createServer } from "./server";

async function main() {
  const config = loadConfig();
  const app = createServer(config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
