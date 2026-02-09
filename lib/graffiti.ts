import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type Position = {
  x: number;
  y: number;
};

export type Dimensions = {
  width: number;
  height: number;
};

export type GraffitiImage = {
  id: string;
  type: "image";
  imageUrl: string;
  position: Position;
  dimensions: Dimensions;
  rotation: number;
  opacity: number;
  createdAt: string;
};

export type GraffitiText = {
  id: string;
  type: "text";
  text: string;
  font: string;
  color: string;
  position: Position;
  size: number;
  rotation: number;
  opacity: number;
  createdAt: string;
};

export type GraffitiItem = GraffitiImage | GraffitiText;

const DATA_FILE = path.join(process.cwd(), "data", "graffiti.json");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]", "utf8");
  }
}

export async function getGraffiti(): Promise<GraffitiItem[]> {
  await ensureDataFile();

  const raw = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(raw) as GraffitiItem[];
  return parsed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

type NewGraffitiImage = Omit<GraffitiImage, "id" | "createdAt">;
type NewGraffitiText = Omit<GraffitiText, "id" | "createdAt">;
type NewGraffitiItem = NewGraffitiImage | NewGraffitiText;

export async function addGraffiti(item: NewGraffitiImage): Promise<GraffitiImage>;
export async function addGraffiti(item: NewGraffitiText): Promise<GraffitiText>;
export async function addGraffiti(item: NewGraffitiItem): Promise<GraffitiItem> {
  const next: GraffitiItem =
    item.type === "image"
      ? {
          ...item,
          id: randomUUID(),
          createdAt: new Date().toISOString()
        }
      : {
          ...item,
          id: randomUUID(),
          createdAt: new Date().toISOString()
        };

  const existing = await getGraffiti();
  existing.push(next);

  await fs.writeFile(DATA_FILE, JSON.stringify(existing, null, 2), "utf8");
  return next;
}

export async function saveImageBlob(base64OrDataUrl: string): Promise<string> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const dataUrlMatch = base64OrDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  const ext = dataUrlMatch?.[1] ?? "png";
  const base64 = dataUrlMatch?.[2] ?? base64OrDataUrl;

  const fileName = `${randomUUID()}.${ext}`;
  const outPath = path.join(UPLOAD_DIR, fileName);

  await fs.writeFile(outPath, Buffer.from(base64, "base64"));
  return `/uploads/${fileName}`;
}
