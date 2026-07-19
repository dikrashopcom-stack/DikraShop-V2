import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

export function ensureLabelsDir(): void {
  const p = path.resolve(env.LABELS_DIR);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Pick a file extension from the response content-type; default to .pdf since ZR
// shipping labels are PDFs. Never assume .html — treating a PDF as text corrupts it.
export function extensionForContentType(contentType: string | undefined): string {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("html")) return ".html";
  if (ct.includes("png")) return ".png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  return ".pdf";
}

export async function downloadLabel(trackingNumber: string, labelUrl: string): Promise<string> {
  ensureLabelsDir();
  const safe = trackingNumber.replace(/[^a-zA-Z0-9\-_]/g, "_");

  logger.info("Downloading label", { trackingNumber, labelUrl });
  // arraybuffer preserves binary bytes; text + utf-8 re-encoding mangles a PDF.
  const res = await axios.get<ArrayBuffer>(labelUrl, { responseType: "arraybuffer", timeout: 15_000 });

  const ext = extensionForContentType(res.headers["content-type"] as string | undefined);
  const fileName = "label_" + safe + "_" + Date.now() + ext;
  const localPath = path.resolve(env.LABELS_DIR, fileName);

  fs.writeFileSync(localPath, Buffer.from(res.data));
  logger.info("Label saved", { localPath });
  return localPath;
}
