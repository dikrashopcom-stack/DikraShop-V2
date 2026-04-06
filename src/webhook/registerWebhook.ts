import * as https from "https";
import { env } from "../utils/env";
import { logger } from "../utils/logger";

/** Fetch a short-lived Admin API token using the OAuth client-credentials grant. */
async function fetchAccessToken(store: string, clientId: string, clientSecret: string): Promise<string> {
  const body = JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: store,
        path: "/admin/oauth/access_token",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.access_token) {
              resolve(parsed.access_token);
            } else {
              reject(new Error("No access_token in response: " + data));
            }
          } catch (e) {
            reject(new Error("Failed to parse token response: " + data));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function registerShopifyWebhook(): Promise<void> {
  const store = env.SHOPIFY_STORE_URL;
  const clientId = env.SHOPIFY_CLIENT_ID;
  const clientSecret = env.SHOPIFY_CLIENT_SECRET;
  const appUrl = env.APP_URL;

  if (!store || !clientId || !clientSecret || !appUrl) {
    logger.warn("Shopify webhook registration skipped — SHOPIFY_STORE_URL, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, or APP_URL not set.");
    return;
  }

  let token: string;
  try {
    token = await fetchAccessToken(store, clientId, clientSecret);
    logger.info("Shopify access token fetched successfully");
  } catch (err) {
    logger.error("Failed to fetch Shopify access token", { err });
    return;
  }

  const webhookUrl = `${appUrl}/webhooks/orders/create`;
  const body = JSON.stringify({
    webhook: { topic: "orders/create", address: webhookUrl, format: "json" },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: store,
        path: "/admin/api/2026-01/webhooks.json",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const parsed = JSON.parse(data);
          if (parsed.webhook) {
            logger.info("Shopify webhook registered", { address: parsed.webhook.address, id: parsed.webhook.id });
          } else if (parsed.errors) {
            const msg = JSON.stringify(parsed.errors);
            if (msg.includes("already")) {
              logger.info("Shopify webhook already registered");
            } else {
              logger.error("Shopify webhook registration failed", { errors: parsed.errors });
            }
          }
          resolve();
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
