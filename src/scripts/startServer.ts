import express from "express";
import { handleOrderCreate } from "../webhook/handler";
import { registerShopifyWebhook } from "../webhook/registerWebhook";
import { zrWebhookRouter } from "../webhooks/zrWebhook";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

const app = express();

// Raw body needed for Shopify HMAC verification
app.use("/webhooks", express.raw({ type: "application/json" }));

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "dikrashop-shipping" });
});

// Shallow liveness — process is up and serving.
app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness — the config the service needs to operate SAFELY in production is present.
// In production, missing SHOPIFY_WEBHOOK_SECRET means the HMAC guard rejects everything,
// so we report not-ready (503) rather than accept traffic that will all 401.
app.get("/readyz", (_req, res) => {
  const checks = {
    shopifyWebhookSecret: Boolean(env.SHOPIFY_WEBHOOK_SECRET),
    zrWebhookSecret: Boolean(env.WEBHOOK_SECRET),
  };
  const requiredInProd = env.NODE_ENV !== "production" || checks.shopifyWebhookSecret;
  res.status(requiredInProd ? 200 : 503).json({
    status: requiredInProd ? "ready" : "not-ready",
    nodeEnv: env.NODE_ENV,
    checks,
  });
});

app.post("/webhooks/orders/create", handleOrderCreate);
app.use("/webhooks/zrexpress", zrWebhookRouter);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
  registerShopifyWebhook().catch((err) => logger.error("Webhook registration failed", { err }));
});
