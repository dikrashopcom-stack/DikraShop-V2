import * as path from "path";
import { fetchOrderByPageId, appendDesignResult } from "../clients/notion";
import { getMoonPhase } from "../clients/moonPhase";
import { renderMoonDesign } from "./renderService";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

// ── Types ──────────────────────────────────────────────────────────────────────

export type MoonDesignStatus = "success" | "failed";

export interface MoonDesignResult {
  status: MoonDesignStatus;
  outputPath?: string;    // absolute path to the generated PNG
  moonPhase?: string;     // raw phase name, e.g. "Waxing Gibbous"
  error?: string;
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

export async function generateMoonDesign(pageId: string): Promise<MoonDesignResult> {
  logger.info("Moon design pipeline started", { pageId });

  // ── Step 1: Fetch order from Notion ─────────────────────────────────────────
  const order = await fetchOrderByPageId(pageId);
  if (!order) {
    return fail(`Could not fetch Notion page: ${pageId}`);
  }
  logger.info("Order fetched", { orderNumber: order.رقم_الطلب, pageId });

  // ── Step 2: Extract design fields ───────────────────────────────────────────

  // Recipient name: prefer the "name on the frame" field, fall back to customer name
  const recipientName = order.الإسم_في_اللوحة ?? order.اسم_صاحب_الطلبية;
  if (!recipientName) {
    return fail(
      'Missing recipient name. Set "الإسم في اللوحة" (or "اسم صاحب الطلبية") on the Notion order.'
    );
  }

  // Event date: must be a Notion "date" property
  // TODO: confirm the Notion property name matches "تاريخ الحدث" in your database
  const eventDateRaw = order.تاريخ_الحدث;
  if (!eventDateRaw) {
    return fail(
      'Missing event date. Add a date property called "تاريخ الحدث" to the Notion database and fill it in for this order.'
    );
  }

  const eventDate = new Date(eventDateRaw);
  if (isNaN(eventDate.getTime())) {
    return fail(`Invalid event date value: "${eventDateRaw}"`);
  }

  const phrase    = order.العبارة_في_اللوحة; // optional
  // TODO: add a Notion "select" property called "الخط" if you want per-order font control
  const fontChoice = order.الخط;             // optional

  logger.info("Design inputs ready", {
    recipientName,
    eventDate: eventDate.toISOString(),
    hasPhrase: !!phrase,
    fontChoice: fontChoice ?? "(default)",
  });

  // ── Step 3: Get moon phase ───────────────────────────────────────────────────
  let moonPhaseResult;
  try {
    moonPhaseResult = await getMoonPhase(eventDate);
  } catch (err) {
    return fail(`Moon phase API failed: ${errMsg(err)}`);
  }

  // ── Step 4: Render image ─────────────────────────────────────────────────────
  const safePageId = pageId.replace(/-/g, "").slice(0, 8);
  const filename   = `moon_design_${safePageId}_${Date.now()}.png`;
  const outputPath = path.resolve(env.OUTPUT_DIR, filename);

  try {
    await renderMoonDesign(
      {
        moonPhase: moonPhaseResult.mappedPhase,
        recipientName,
        eventDate,
        phrase,
        fontChoice,
      },
      outputPath
    );
  } catch (err) {
    return fail(`Render failed: ${errMsg(err)}`);
  }

  // ── Step 5: Write result back to Notion ──────────────────────────────────────
  try {
    await appendDesignResult(pageId, {
      outputPath,
      moonPhase: moonPhaseResult.rawPhase,
    });
  } catch (err) {
    // Non-fatal: the image was saved successfully; Notion update just failed.
    logger.warn("Could not write result to Notion (image is still saved locally)", {
      pageId,
      outputPath,
      err,
    });
  }

  logger.info("Moon design pipeline complete", {
    pageId,
    outputPath,
    moonPhase: moonPhaseResult.rawPhase,
  });

  return { status: "success", outputPath, moonPhase: moonPhaseResult.rawPhase };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fail(error: string): MoonDesignResult {
  logger.error("Moon design failed", { error });
  return { status: "failed", error };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
