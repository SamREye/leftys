import express from "express";
import { createMcpRouter } from "./routes.ts";

const PORT = Number(process.env.MCP_PORT ?? 3334);

const app = express();
app.use(createMcpRouter());

app.listen(PORT, () => {
  console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
});
