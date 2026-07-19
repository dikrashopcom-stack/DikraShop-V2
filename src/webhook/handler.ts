import * as crypto from "crypto";
import { Request, Response } from "express";
import { createOrderFromShopify, ShopifyOrderPayload } from "../clients/notion";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

function verifyHmac(rawBody: Buffer, hmacHeader: string): boolean {
  const secret = env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed in production — an unset secret must never mean "accept everything".
    // Only skip verification in explicitly non-production environments (local dev/tests).
    if (env.NODE_ENV === "production") {
      logger.error("SHOPIFY_WEBHOOK_SECRET is not set in production — rejecting webhook");
      return false;
    }
    logger.warn("SHOPIFY_WEBHOOK_SECRET not set — skipping HMAC check (non-production only)");
    return true;
  }

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

export async function handleOrderCreate(req: Request, res: Response): Promise<void> {
  const hmac = req.headers["x-shopify-hmac-sha256"] as string | undefined;

  if (!hmac || !verifyHmac(req.body as Buffer, hmac)) {
    logger.warn("Shopify webhook rejected — invalid HMAC");
    res.status(401).send("Unauthorized");
    return;
  }

  let order: ShopifyOrderPayload;
  try {
    order = JSON.parse((req.body as Buffer).toString());
  } catch (err) {
    // Malformed body will never parse on retry either — ack so Shopify stops resending.
    logger.error("Failed to parse Shopify order payload", { err });
    res.status(200).send("OK");
    return;
  }

  logger.info("New Shopify order received", { orderId: order.id, orderNumber: order.order_number });

  // Persist to Notion BEFORE acknowledging. If the write fails we return 5xx so
  // Shopify retries — a premature 200 here silently drops the paid order forever.
  try {
    const pageId = await createOrderFromShopify(order);
    logger.info("Order synced to Notion", { pageId });
    res.status(200).send("OK");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to create Notion page for order", { orderId: order.id, error: message });
    res.status(500).send("Failed to persist order");
  }
}
