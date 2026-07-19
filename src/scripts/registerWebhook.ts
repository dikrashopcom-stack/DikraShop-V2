/**
 * One-time script: register the ZR Express webhook endpoint and retrieve the signing secret.
 *
 * Usage:
 *   npm run webhook:register
 *
 * Required env vars:
 *   ZR_ACCESS_TOKEN   — ZR Bearer token (may be the same value as ZR_API_KEY)
 *   ZR_TENANT_ID      — ZR tenant ID
 *   ZR_WEBHOOK_URL    — Full public HTTPS URL of the /webhooks/zrexpress route
 *                       e.g. https://your-server.com/webhooks/zrexpress
 *
 * After running:
 *   Copy the printed whsec_... value into your .env as WEBHOOK_SECRET.
 */

import * as dotenv from 'dotenv';
import axios, { AxiosError } from 'axios';

dotenv.config();

// ── Read required env ─────────────────────────────────────────────────────────
const ZR_ACCESS_TOKEN = process.env.ZR_ACCESS_TOKEN ?? process.env.ZR_API_KEY;
const ZR_TENANT_ID = process.env.ZR_TENANT_ID;
const ZR_WEBHOOK_URL = process.env.ZR_WEBHOOK_URL;

const ZR_WEBHOOK_BASE = 'https://api.zrexpress.app/api/v1/webhooks/endpoints';

function extractErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.message === 'string') return data.message;
    if (typeof data?.title === 'string') return `${data.title} (HTTP ${err.response?.status})`;
    if (data?.errors) return JSON.stringify(data.errors);
    return `HTTP ${err.response?.status ?? '?'} — ${JSON.stringify(data ?? '').slice(0, 300)}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function run(): Promise<void> {
  // ── Validate inputs ─────────────────────────────────────────────────────────
  if (!ZR_ACCESS_TOKEN) {
    console.error('❌  ZR_ACCESS_TOKEN (or ZR_API_KEY) is not set in .env');
    process.exit(1);
  }
  if (!ZR_TENANT_ID) {
    console.error('❌  ZR_TENANT_ID is not set in .env');
    process.exit(1);
  }
  if (!ZR_WEBHOOK_URL) {
    console.error('❌  ZR_WEBHOOK_URL is not set in .env');
    console.error('   Example: ZR_WEBHOOK_URL=https://your-server.com/webhooks/zrexpress');
    process.exit(1);
  }
  if (!ZR_WEBHOOK_URL.startsWith('https://')) {
    console.error('❌  ZR_WEBHOOK_URL must be an HTTPS URL (ZR Express requires HTTPS)');
    process.exit(1);
  }

  const headers = {
    Authorization: `Bearer ${ZR_ACCESS_TOKEN}`,
    'X-Api-Key': process.env.ZR_API_KEY ?? ZR_ACCESS_TOKEN,
    'X-Tenant': ZR_TENANT_ID,
    'Content-Type': 'application/json',
  };

  // ── Step 1: Register endpoint ────────────────────────────────────────────────
  console.log(`\n📡  Registering webhook endpoint: ${ZR_WEBHOOK_URL}\n`);

  let endpointId: string;
  try {
    const res = await axios.post<{ id: string }>(
      ZR_WEBHOOK_BASE,
      {
        url: ZR_WEBHOOK_URL,
        description: 'Dikrashop v2 — parcel lifecycle events → Notion',
        eventTypes: [
          'parcel.state.updated',
          'parcel.state.situation.created',
          'parcel.isReturn.updated',
        ],
      },
      { headers },
    );

    endpointId = res.data.id;
    console.log(`✅  Endpoint registered successfully.`);
    console.log(`    Endpoint ID: ${endpointId}\n`);
  } catch (err) {
    const message = extractErrorMessage(err);

    // Handle the documented 5-endpoint limit gracefully
    if (message.includes('LimitReached') || message.includes('Endpoints.LimitReached')) {
      console.error('❌  ZR Express has a 5-endpoint limit and it has been reached.');
      console.error('    Delete an existing endpoint via the ZR dashboard or API, then retry.\n');

      // Attempt to list existing endpoints
      try {
        console.log('   Fetching existing endpoints...\n');
        const listRes = await axios.get<{ items?: Array<{ id: string; url: string; description?: string }> }>(
          ZR_WEBHOOK_BASE,
          { headers },
        );
        const items = listRes.data.items ?? (listRes.data as unknown as Array<{ id: string; url: string }>);
        if (Array.isArray(items) && items.length > 0) {
          console.log('   Existing endpoints:');
          items.forEach((ep) => {
            console.log(`     • ID: ${ep.id}  URL: ${ep.url}`);
          });
        }
      } catch {
        console.log('   (Could not fetch endpoint list — check the ZR dashboard manually.)');
      }
      process.exit(1);
    }

    console.error(`❌  Failed to register webhook endpoint: ${message}`);
    process.exit(1);
  }

  // ── Step 2: Retrieve signing secret ─────────────────────────────────────────
  console.log(`🔑  Fetching signing secret for endpoint ${endpointId}...\n`);

  try {
    const secretRes = await axios.get<{ key: string }>(
      `${ZR_WEBHOOK_BASE}/${endpointId}/secret`,
      { headers },
    );

    const secret = secretRes.data.key;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅  Webhook registered and signing secret retrieved.\n');
    console.log(`   WEBHOOK_SECRET=${secret}\n`);
    console.log('👉  Add the line above to your .env file, then restart the server.');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (err) {
    const message = extractErrorMessage(err);
    console.error(`❌  Endpoint was registered (ID: ${endpointId}) but failed to retrieve the secret: ${message}`);
    console.error(`   Retrieve it manually: GET ${ZR_WEBHOOK_BASE}/${endpointId}/secret`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
