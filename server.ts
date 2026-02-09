import express from "express";
import next from "next";
import { createMcpRouter } from "./mcp/routes.ts";

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

async function main(): Promise<void> {
  const nextApp = next({ dev, hostname: "0.0.0.0", port });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  const app = express();
  app.set("trust proxy", true);
  app.use(createMcpRouter());

  app.all("*", (req, res) => {
    void handle(req, res);
  });

  app.listen(port, () => {
    console.log(`Web + MCP server listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
