import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NOTION_TOKEN: z.string().min(10),
  NOTION_DATABASE_ID: z.string().min(10),
  ZR_API_KEY: z.string().min(10),
  ZR_TENANT_ID: z.string().min(10),
  ZR_BASE_URL: z.string().url().default("https://api.zrexpress.app/api/v1.0"),
  LABELS_DIR: z.string().default("./labels"),
  OUTPUT_DIR: z.string().default("./output"),
  BATCH_SIZE: z.string().default("10").transform((v) => parseInt(v, 10)),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Shopify webhook server (optional — only required when running `npm start`)
  SHOPIFY_STORE_URL: z.string().optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),
  APP_URL: z.string().url().optional(),
  PORT: z.string().default("3000").transform((v) => parseInt(v, 10)),
  // ZR Express webhook receiver — set after running `npm run webhook:register`
  WEBHOOK_SECRET: z.string().optional(),           // whsec_... signing secret from ZR
  ZR_WEBHOOK_URL: z.string().url().optional(),     // Public HTTPS URL of /webhooks/zrexpress
  ZR_ACCESS_TOKEN: z.string().optional(),          // Bearer token for webhook registration (falls back to ZR_API_KEY if unset)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  parsed.error.errors.forEach((e) => {
    console.error(`   ${e.path.join(".")}: ${e.message}`);
  });
  console.error("\n👉 Copy .env.example to .env and fill in your values.\n");
  process.exit(1);
}

export const env = parsed.data;
