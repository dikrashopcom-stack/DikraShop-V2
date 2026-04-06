import express from "express";
import { handleOrderCreate } from "../webhook/handler";
import { registerShopifyWebhook } from "../webhook/registerWebhook";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

const app = express();

// Raw body needed for Shopify HMAC verification
app.use("/webhooks", express.raw({ type: "application/json" }));

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "dikrashop-shipping" });
});

app.post("/webhooks/orders/create", handleOrderCreate);

app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT}`);
  registerShopifyWebhook().catch((err) => logger.error("Webhook registration failed", { err }));
});
