import { markAsProcessing, writeShipmentResult } from "../clients/notion";
import { createParcel, generateIndividualLabel, getParcelByTracking, extractZRError } from "../clients/zr";
import { validateOrder } from "./orderValidation";
import { mapOrderToZRPayload } from "./orderMapping";
import { downloadLabel } from "./labelService";
import { NotionOrderRaw } from "../types/notionOrder";
import { logger } from "../utils/logger";
import { AxiosError } from "axios";

export type ShipmentResult =
  | { status: "success"; notionPageId: string; orderNumber: string; trackingNumber: string; zrParcelId: string; labelUrl: string; localLabelPath: string }
  | { status: "skipped"; notionPageId: string; orderNumber: string; reason: string }
  | { status: "failed";  notionPageId: string; orderNumber: string; error: string; phase: "validation" | "parcel_creation" | "label_generation" | "download" };

// Extract ZR parcel ID from a 409 duplicate error response
function extractDuplicateParcelId(err: unknown): string | null {
  if (!(err instanceof AxiosError)) return null;
  if (err.response?.status !== 409) return null;
  // ZR may return the existing parcel ID in the error — check common fields
  const data = err.response?.data as Record<string, unknown> | undefined;
  if (!data) return null;
  // Try common field names
  const id = data.parcelId ?? data.id ?? data.existingParcelId ?? data.resourceId;
  return typeof id === "string" ? id : null;
}

export async function processOrder(raw: NotionOrderRaw): Promise<ShipmentResult> {
  const pageId   = raw.notionPageId;
  const orderNum = raw.رقم_الطلب ?? pageId;

  logger.info("Processing order", { orderId: orderNum, notionPageId: pageId });

  // ── Idempotency guard ──────────────────────────────────────────────────────
  if (raw.رقم_التتبع || raw.ZR_Parcel_ID) {
    const reason = "Already shipped (tracking: " + raw.رقم_التتبع + ", parcelId: " + raw.ZR_Parcel_ID + ")";
    logger.warn("Skipping — already shipped", { orderId: orderNum });
    return { status: "skipped", notionPageId: pageId, orderNumber: orderNum, reason };
  }
  if (raw.حالة_الشحن === "⏳ Processing") {
    const reason = "Status is ⏳ Processing — another run may be in progress";
    logger.warn(reason, { orderId: orderNum });
    return { status: "skipped", notionPageId: pageId, orderNumber: orderNum, reason };
  }

  // ── Step 1: Validate ───────────────────────────────────────────────────────
  const validation = await validateOrder(raw);
  if (!validation.success) {
    const errorMsg = validation.errors.join(" | ");
    await writeShipmentResult(pageId, { shipmentStatus: "❌ Failed", errorMessage: "Validation: " + errorMsg });
    return { status: "failed", notionPageId: pageId, orderNumber: orderNum, error: errorMsg, phase: "validation" };
  }

  const order = validation.order;

  // ── Step 2: Lock ───────────────────────────────────────────────────────────
  await markAsProcessing(pageId);

  // ── Step 3: Create parcel ──────────────────────────────────────────────────
  let zrParcelId: string;

  try {
    const payload = mapOrderToZRPayload(order);
    const zrRes   = await createParcel(payload);
    zrParcelId = zrRes.id ?? "";
    if (!zrParcelId) throw new Error("ZR response missing id. Raw: " + JSON.stringify(zrRes).slice(0, 300));
    logger.info("Parcel created", { orderId: order.orderNumber, zrParcelId });
  } catch (err) {
    // 409 = duplicate externalId — parcel already exists in ZR
    // This can happen if a previous run created the parcel but failed before writing to Notion
    if (err instanceof AxiosError && err.response?.status === 409) {
      logger.warn("Parcel already exists in ZR (409). Will fetch tracking number directly.", { orderId: order.orderNumber });
      // Log full 409 body so we can see if ZR returns the existing parcel ID
      logger.debug("409 body: " + JSON.stringify(err.response?.data));
      const existingId = extractDuplicateParcelId(err);
      if (existingId) {
        zrParcelId = existingId;
        logger.info("Recovered existing parcel ID from 409 response", { zrParcelId });
      } else {
        // ZR didn't return the parcel ID in the 409 — we can't recover automatically
        const errorMsg = "Parcel already exists in ZR for externalId " + order.orderNumber +
          " but ZR did not return the existing parcel ID. " +
          "Please find the parcel in the ZR portal and manually enter the ZR Parcel ID in Notion, then retry.";
        await writeShipmentResult(pageId, { shipmentStatus: "❌ Failed", errorMessage: errorMsg });
        return { status: "failed", notionPageId: pageId, orderNumber: order.orderNumber, error: errorMsg, phase: "parcel_creation" };
      }
    } else {
      const errorMsg = extractZRError(err);
      await writeShipmentResult(pageId, { shipmentStatus: "❌ Failed", errorMessage: "Parcel creation: " + errorMsg });
      return { status: "failed", notionPageId: pageId, orderNumber: order.orderNumber, error: errorMsg, phase: "parcel_creation" };
    }
  }

  // ── Step 4: Fetch real tracking number ────────────────────────────────────
  let trackingNumber: string;

  try {
    logger.info("Fetching tracking number", { zrParcelId });
    const parcelDetails = await getParcelByTracking(zrParcelId);
    logger.debug("Parcel details: " + JSON.stringify(parcelDetails));
    const tn = parcelDetails.trackingNumber as string | undefined;
    if (!tn) throw new Error("trackingNumber field missing in parcel details. Raw: " + JSON.stringify(parcelDetails).slice(0, 300));
    trackingNumber = tn;
    logger.info("Got tracking number", { trackingNumber, zrParcelId });
  } catch (err) {
    const errorMsg = "Failed to fetch tracking number: " + (err instanceof Error ? err.message : String(err));
    await writeShipmentResult(pageId, { shipmentStatus: "❌ Failed", zrParcelId, errorMessage: errorMsg });
    return { status: "failed", notionPageId: pageId, orderNumber: order.orderNumber, error: errorMsg, phase: "parcel_creation" };
  }

  // ── Step 5: Generate label ─────────────────────────────────────────────────
  let labelUrl: string;

  try {
    const labelRes = await generateIndividualLabel([trackingNumber]);
    // Confirmed field name from ZR API: "parcelLabelFiles" (not "labels" or "succeeded")
    const results  = (labelRes.parcelLabelFiles ?? labelRes.labels ?? labelRes.succeeded ?? []) as Array<{ trackingNumber?: string; fileUrl?: string }>;
    const item     = results.find((l) => l.trackingNumber === trackingNumber || l.fileUrl);
    labelUrl       = item?.fileUrl ?? "";
    if (!labelUrl) {
      const failed = (labelRes.failedTrackingNumbers ?? labelRes.failed ?? []) as string[];
      if (failed.includes(trackingNumber)) throw new Error("ZR returned " + trackingNumber + " as a failed label");
      throw new Error("Label URL not found in: " + JSON.stringify(labelRes).slice(0, 300));
    }
  } catch (err) {
    const errorMsg = extractZRError(err);
    await writeShipmentResult(pageId, { shipmentStatus: "❌ Failed", zrParcelId, trackingNumber, errorMessage: "Label: " + errorMsg });
    return { status: "failed", notionPageId: pageId, orderNumber: order.orderNumber, error: errorMsg, phase: "label_generation" };
  }

  // ── Step 6: Download label ─────────────────────────────────────────────────
  let localLabelPath: string;

  try {
    localLabelPath = await downloadLabel(trackingNumber, labelUrl);
  } catch (err) {
    const errorMsg = "Download failed: " + (err instanceof Error ? err.message : String(err));
    await writeShipmentResult(pageId, { shipmentStatus: "✅ Shipped", zrParcelId, trackingNumber, labelUrl, errorMessage: errorMsg + " (label URL saved)" });
    return { status: "failed", notionPageId: pageId, orderNumber: order.orderNumber, error: errorMsg, phase: "download" };
  }

  // ── Step 7: Write success ──────────────────────────────────────────────────
  await writeShipmentResult(pageId, { shipmentStatus: "✅ Shipped", zrParcelId, trackingNumber, labelUrl });
  logger.info("✅ Order shipped", { orderId: order.orderNumber, zrParcelId, trackingNumber, localLabelPath });
  return { status: "success", notionPageId: pageId, orderNumber: order.orderNumber, trackingNumber, zrParcelId, labelUrl, localLabelPath };
}

export async function processBatch(orders: NotionOrderRaw[]): Promise<ShipmentResult[]> {
  const results: ShipmentResult[] = [];
  for (const order of orders) {
    try {
      results.push(await processOrder(order));
    } catch (err) {
      logger.error("Unexpected error", { notionPageId: order.notionPageId, err });
      try {
        await writeShipmentResult(order.notionPageId, { shipmentStatus: "❌ Failed", errorMessage: "Unexpected: " + (err instanceof Error ? err.message : String(err)) });
      } catch { /* ignore */ }
      results.push({ status: "failed", notionPageId: order.notionPageId, orderNumber: order.رقم_الطلب ?? order.notionPageId, error: String(err), phase: "parcel_creation" });
    }
  }
  return results;
}

export function printBatchSummary(results: ShipmentResult[]): void {
  const success = results.filter((r) => r.status === "success");
  const failed  = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped");
  console.log("\n" + "═".repeat(55));
  console.log("📦 BATCH SUMMARY");
  console.log("═".repeat(55));
  console.log("  ✅ Shipped:  " + success.length);
  console.log("  ❌ Failed:   " + failed.length);
  console.log("  ⏭️  Skipped:  " + skipped.length);
  if (success.length) { console.log("\n✅ Shipped:"); success.forEach((r) => { if (r.status === "success") console.log("   " + r.orderNumber + " → " + r.trackingNumber); }); }
  if (failed.length)  { console.log("\n❌ Failed:");  failed.forEach((r)  => { if (r.status === "failed")  console.log("   " + r.orderNumber + " [" + r.phase + "] — " + r.error); }); }
  console.log("═".repeat(55) + "\n");
}
