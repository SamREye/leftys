import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { addGraffiti, saveImageBlob } from "../lib/graffiti.ts";

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

function normalizePercentPair(
  first: number,
  second: number
): { first: number; second: number; normalized: boolean } {
  const fractionRange = (value: number) => value >= 0 && value < 1;
  const shouldNormalize = fractionRange(first) && fractionRange(second);

  if (!shouldNormalize) {
    return { first, second, normalized: false };
  }

  return {
    first: first * 100,
    second: second * 100,
    normalized: true
  };
}

function createMcpServer(): McpServer {
  const mcpServer = new McpServer({
    name: "leftys-graffiti-wall",
    version: "0.1.0"
  }, {
    instructions:
      "Lefty's bathroom graffiti MCP server. Use spray_text to add styled text tags and spray_image to place image stickers on the shared wall. Coordinates and dimensions MUST be percentages from 0 to 100, where 45 means 45 percent (not 0.45)."
  });

  mcpServer.tool(
    "spray_text",
    "Add a text tag to the graffiti wall with font/color/size, position, rotation, and opacity. position.x and position.y must be 0-100 percentages (example: 45 means 45%).",
    sprayTextSchema,
    async (args) => {
    const normalizedPosition = normalizePercentPair(args.position.x, args.position.y);

    const item = await addGraffiti({
      type: "text",
      text: args.text,
      font: args.font,
      color: args.color,
      position: {
        x: normalizedPosition.first,
        y: normalizedPosition.second
      },
      size: args.size,
      rotation: args.rotation,
      opacity: args.opacity
    });

    return {
      content: [
        {
          type: "text",
          text: normalizedPosition.normalized
            ? `spray_text created ${item.id} (normalized 0-1 position fractions to 0-100 percentages)`
            : `spray_text created ${item.id}`
        }
      ]
    };
    }
  );

  mcpServer.tool(
    "spray_image",
    "Add an image sticker to the graffiti wall using image_url or image_blob plus position, size, rotation, and opacity. position/dimensions values must be 0-100 percentages (example: 20 means 20%).",
    sprayImageSchema,
    async (args) => {
    sprayImageInput.parse(args);
    const normalizedPosition = normalizePercentPair(args.position.x, args.position.y);
    const normalizedDimensions = normalizePercentPair(args.dimensions.width, args.dimensions.height);

    const imageUrl = args.image_url ?? (await saveImageBlob(args.image_blob!));

    const item = await addGraffiti({
      type: "image",
      imageUrl,
      position: {
        x: normalizedPosition.first,
        y: normalizedPosition.second
      },
      dimensions: {
        width: normalizedDimensions.first,
        height: normalizedDimensions.second
      },
      rotation: args.rotation,
      opacity: args.opacity
    });

    return {
      content: [
        {
          type: "text",
          text:
            normalizedPosition.normalized || normalizedDimensions.normalized
              ? `spray_image created ${item.id} (normalized 0-1 fractions to 0-100 percentages)`
              : `spray_image created ${item.id}`
        }
      ]
    };
    }
  );

  return mcpServer;
}

export function createMcpRouter(): express.Router {
  const router = express.Router();
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Map<string, McpServer>();

  router.use(express.json({ limit: "15mb" }));

  router.post("/mcp", async (req, res) => {
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

  router.get("/mcp", async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send("No active MCP session.");
      return;
    }

    await transport.handleRequest(req, res);
  });

  router.delete("/mcp", async (req, res) => {
    const sessionId = req.header("mcp-session-id");
    const transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      res.status(400).send("No active MCP session.");
      return;
    }

    await transport.handleRequest(req, res);
  });

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return router;
}
