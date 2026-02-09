import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { addGraffiti, saveImageBlob } from "../lib/graffiti.ts";

const PORT = Number(process.env.MCP_PORT ?? 3334);

const percent = z.number().min(0).max(100);
const rotation = z.number().min(-360).max(360).default(0);
const opacity = z.number().min(0).max(1).default(1);

const positionSchema = z.object({
  x: percent,
  y: percent
});

const dimensionsSchema = z.object({
  width: percent,
  height: percent
});

const sprayTextSchema = {
  text: z.string().min(1),
  font: z.string().default("Impact, sans-serif"),
  color: z.string().default("#111111"),
  position: positionSchema,
  size: z.number().min(8).max(300).default(42),
  rotation,
  opacity
};

const sprayImageSchema = {
  image_url: z.string().url().optional(),
  image_blob: z.string().optional(),
  position: positionSchema,
  dimensions: dimensionsSchema,
  rotation,
  opacity
};

const sprayImageInput = z
  .object(sprayImageSchema)
  .refine((value) => Boolean(value.image_url || value.image_blob), {
    message: "Provide image_url or image_blob"
  });

function createMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: "leftys-graffiti-wall",
    version: "0.1.0"
  });

  mcpServer.tool("spray_text", sprayTextSchema, async (args) => {
    const item = await addGraffiti({
      type: "text",
      text: args.text,
      font: args.font,
      color: args.color,
      position: args.position,
      size: args.size,
      rotation: args.rotation,
      opacity: args.opacity
    });

    return {
      content: [{ type: "text", text: `spray_text created ${item.id}` }]
    };
  });

  mcpServer.tool("spray_image", sprayImageSchema, async (args) => {
    sprayImageInput.parse(args);

    const imageUrl = args.image_url ?? (await saveImageBlob(args.image_blob!));

    const item = await addGraffiti({
      type: "image",
      imageUrl,
      position: args.position,
      dimensions: args.dimensions,
      rotation: args.rotation,
      opacity: args.opacity
    });

    return {
      content: [{ type: "text", text: `spray_image created ${item.id}` }]
    };
  });

  return mcpServer;
}

const app = express();
app.use(express.json({ limit: "15mb" }));

const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, McpServer>();

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id");
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ error: "Client must send initialize request first" });
        return;
      }

      const server = createMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
          servers.set(id, server);
        }
      });

      transport.onclose = () => {
        const id = transport?.sessionId;
        if (!id) return;

        transports.delete(id);
        const closedServer = servers.get(id);
        servers.delete(id);
        void closedServer?.close().catch(() => {});
      };

      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    res.status(400).send("No active MCP session.");
    return;
  }

  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.header("mcp-session-id");
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    res.status(400).send("No active MCP session.");
    return;
  }

  await transport.handleRequest(req, res);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`MCP server listening on http://localhost:${PORT}/mcp`);
});
