import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const serverUrl = process.env.MCP_SERVER_URL ?? "http://localhost:3334/mcp";

function parseJsonArg(raw?: string): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  return JSON.parse(raw) as Record<string, unknown>;
}

async function maybeInlineImageBlob(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = args.image_blob_file;
  if (typeof path !== "string") {
    return args;
  }

  const bytes = await readFile(path);
  const next = { ...args };
  next.image_blob = bytes.toString("base64");
  delete next.image_blob_file;
  return next;
}

async function main() {
  const toolName = process.argv[2];
  const rawArgs = process.argv[3];

  if (!toolName) {
    console.error("Usage: npm run mcp:client -- <tool_name> '<json_args>'");
    process.exit(1);
  }

  const args = await maybeInlineImageBlob(parseJsonArg(rawArgs));

  const client = new Client({
    name: "Lefty's-graffiti-client",
    version: "0.1.0"
  });

  const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
  await client.connect(transport);

  const result = await client.callTool({
    name: toolName,
    arguments: args
  });

  console.log(JSON.stringify(result, null, 2));
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
