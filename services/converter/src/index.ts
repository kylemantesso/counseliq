import { loadConfig } from "./config";
import { createServer } from "./server";

const config = loadConfig();
const app = createServer(config);

app.listen({ port: config.port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
