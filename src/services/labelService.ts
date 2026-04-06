import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

export function ensureLabelsDir(): void {
  const p = path.resolve(env.LABELS_DIR);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export async function downloadLabel(trackingNumber: string, labelUrl: string): Promise<string> {
  ensureLabelsDir();
  const safe = trackingNumber.replace(/[^a-zA-Z0-9\-_]/g, "_");
  const fileName = "label_" + safe + "_" + Date.now() + ".html";
  const localPath = path.resolve(env.LABELS_DIR, fileName);

  logger.info("Downloading label", { trackingNumber, labelUrl });
  const res = await axios.get<string>(labelUrl, { responseType: "text", timeout: 15_000 });
  fs.writeFileSync(localPath, res.data, "utf-8");
  logger.info("Label saved", { localPath });
  return localPath;
}
