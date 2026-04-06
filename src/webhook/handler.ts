import * as crypto from "crypto";
import { Request, Response } from "express";
import { createOrderFromShopify, ShopifyOrderPayload } from "../clients/notion";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

function verifyHmac(rawBody: Buffer, hmacHeader: string): boolean {
  const secret = env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev if secret not set

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

  // Acknowledge immediately — Shopify requires a response within 5s
  res.status(200).send("OK");

  let order: ShopifyOrderPayload;
  try {
    order = JSON.parse((req.body as Buffer).toString());
  } catch (err) {
    logger.error("Failed to parse Shopify order payload", { err });
    return;
  }

  logger.info("New Shopify order received", { orderId: order.id, orderNumber: order.order_number });

  try {
    const pageId = await createOrderFromShopify(order);
    logger.info("Order synced to Notion", { pageId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Failed to create Notion page for order", { orderId: order.id, error: message });
  }
}
