import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

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
const PUBLIC_DIR = path.join(process.cwd(), "public");
const SNAPSHOT_DIR = path.join(UPLOAD_DIR, "snapshots");
const BACKGROUND_CANDIDATES = ["leftys-bg.png", "bathroom-wall.jpg", "bathroom-wall.png"];

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

type SnapshotResult = {
  imageUrl: string;
  width: number;
  height: number;
  itemCount: number;
  skippedImages: number;
  fromCache: boolean;
  snapshotKey: string;
};

function percentToPixels(value: number, size: number): number {
  return (value / 100) * size;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function resolveBackgroundPath(): Promise<string> {
  for (const fileName of BACKGROUND_CANDIDATES) {
    const filePath = path.join(PUBLIC_DIR, fileName);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Try next candidate
    }
  }

  throw new Error(
    `No background image found in /public. Expected one of: ${BACKGROUND_CANDIDATES.join(", ")}`
  );
}

async function loadImageSource(imageUrl: string): Promise<Buffer | null> {
  const dataUrlMatch = imageUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (dataUrlMatch) {
    return Buffer.from(dataUrlMatch[1], "base64");
  }

  if (imageUrl.startsWith("/")) {
    const publicRoot = path.resolve(PUBLIC_DIR);
    const resolvedPath = path.resolve(PUBLIC_DIR, imageUrl.replace(/^\/+/, ""));
    if (!resolvedPath.startsWith(`${publicRoot}${path.sep}`)) {
      return null;
    }

    try {
      return await fs.readFile(resolvedPath);
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        return null;
      }

      const bytes = await response.arrayBuffer();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  }

  return null;
}

function textOverlaySvg(item: GraffitiText, width: number, height: number): Buffer {
  const centerX = percentToPixels(item.position.x, width);
  const centerY = percentToPixels(item.position.y, height);
  const lines = item.text.split(/\r?\n/);
  const lineHeight = item.size;
  const startY = centerY - ((lines.length - 1) * lineHeight) / 2;

  const tspans = lines
    .map((line, index) => {
      const y = startY + index * lineHeight;
      return `<tspan x="${centerX}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <g opacity="${item.opacity}" transform="rotate(${item.rotation} ${centerX} ${centerY})">
    <text
      text-anchor="middle"
      font-family="${escapeXml(item.font)}"
      font-size="${item.size}"
      fill="${escapeXml(item.color)}"
    >${tspans}</text>
  </g>
</svg>`;

  return Buffer.from(svg);
}

export async function generateWallSnapshot(): Promise<SnapshotResult> {
  const items = await getGraffiti();
  const latestChangeMs = items.reduce<number | null>((latest, item) => {
    const parsed = Date.parse(item.createdAt);
    if (!Number.isFinite(parsed)) {
      return latest;
    }

    if (latest === null || parsed > latest) {
      return parsed;
    }

    return latest;
  }, null);
  const snapshotKey = latestChangeMs === null ? "empty" : String(latestChangeMs);
  const fileName = `wall-snapshot-${snapshotKey}.png`;
  const outPath = path.join(SNAPSHOT_DIR, fileName);
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

  try {
    await fs.access(outPath);
    const meta = await sharp(outPath).metadata();
    return {
      imageUrl: `/uploads/snapshots/${fileName}`,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      itemCount: items.length,
      skippedImages: 0,
      fromCache: true,
      snapshotKey
    };
  } catch {
    // No cached snapshot for this wall state; render a new one.
  }

  const backgroundPath = await resolveBackgroundPath();
  const backgroundBuffer = await fs.readFile(backgroundPath);
  const background = sharp(backgroundBuffer);
  const metadata = await background.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Background image has unknown dimensions.");
  }

  const width = metadata.width;
  const height = metadata.height;
  const overlays: sharp.OverlayOptions[] = [];
  let skippedImages = 0;

  for (const item of items) {
    if (item.type === "text") {
      overlays.push({
        input: textOverlaySvg(item, width, height)
      });
      continue;
    }

    const imageSource = await loadImageSource(item.imageUrl);
    if (!imageSource) {
      skippedImages += 1;
      continue;
    }

    const targetWidth = Math.max(1, Math.round(percentToPixels(item.dimensions.width, width)));
    const targetHeight = Math.max(1, Math.round(percentToPixels(item.dimensions.height, height)));
    const centerX = percentToPixels(item.position.x, width);
    const centerY = percentToPixels(item.position.y, height);

    const { data, info } = await sharp(imageSource)
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: "contain"
      })
      .rotate(item.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha(item.opacity)
      .png()
      .toBuffer({ resolveWithObject: true });

    overlays.push({
      input: data,
      left: Math.round(centerX - info.width / 2),
      top: Math.round(centerY - info.height / 2)
    });
  }

  const snapshotBuffer = await background.composite(overlays).png().toBuffer();
  await fs.writeFile(outPath, snapshotBuffer);

  return {
    imageUrl: `/uploads/snapshots/${fileName}`,
    width,
    height,
    itemCount: items.length,
    skippedImages,
    fromCache: false,
    snapshotKey
  };
}
