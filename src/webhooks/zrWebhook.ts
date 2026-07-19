import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { Client } from '@notionhq/client';
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { env } from '../utils/env';
import { logger } from '../utils/logger';
import { ZRWebhookEnvelope } from '../types/zrWebhook';

// ── Known state/situation config ──────────────────────────────────────────────
// Add new entries here as they are observed in live events.
// Keys are lowercase-trimmed state names from ZR — used only for recognition and logging.
// The raw `data.state.name` string is always written to Notion as-is.
const KNOWN_STATE_NAMES = new Set([
  'out for delivery',
  'delivered',
  'return',
  'returning',
  'cancelled',
  'in transit',
]);

// Situation slug substrings that indicate a delivery call attempt.
// Exact slug values are not pre-enumerated by ZR — extend this list as new slugs appear in logs.
const CALL_ATTEMPT_KEYWORDS = ['call', 'attempt', 'unavailable'];

// ── Idempotency ───────────────────────────────────────────────────────────────
// In-memory FIFO set. Svix retries happen within ~47 hours, so 1000 entries is sufficient.
const MAX_SEEN_IDS = 1000;
const seenSvixIds = new Set<string>();

/** Returns true if this ID has already been processed successfully. Does NOT mutate. */
function hasSeen(svixId: string): boolean {
  return seenSvixIds.has(svixId);
}

/**
 * Record an ID as successfully processed. Call this only AFTER processing succeeds —
 * marking on receipt would cause a failed attempt to be deduplicated away on Svix's
 * retry, permanently losing the event.
 */
function markProcessed(svixId: string): void {
  if (seenSvixIds.has(svixId)) return;
  if (seenSvixIds.size >= MAX_SEEN_IDS) {
    // Evict oldest entry (Set preserves insertion order)
    const oldest = seenSvixIds.values().next().value as string;
    seenSvixIds.delete(oldest);
  }
  seenSvixIds.add(svixId);
}

// ── Notion client ─────────────────────────────────────────────────────────────
const notionClient = new Client({ auth: env.NOTION_TOKEN });
type NotionProps = Parameters<typeof notionClient.pages.update>[0]['properties'];

/**
 * Query Notion for the order page matching a tracking number.
 * Falls back to matching by order number (externalId) if trackingNumber is absent.
 * Returns null if no page is found.
 */
async function findNotionPage(
  trackingNumber: string | undefined,
  externalId: string | undefined,
): Promise<PageObjectResponse | null> {
  const dbId = env.NOTION_DATABASE_ID;

  if (trackingNumber) {
    const res = await notionClient.databases.query({
      database_id: dbId,
      filter: { property: 'رقم التتبع', rich_text: { equals: trackingNumber } },
      page_size: 1,
    });
    if (res.results.length > 0) return res.results[0] as PageObjectResponse;
  }

  if (externalId) {
    const res = await notionClient.databases.query({
      database_id: dbId,
      filter: { property: 'رقم الطلب', title: { equals: externalId } },
      page_size: 1,
    });
    if (res.results.length > 0) return res.results[0] as PageObjectResponse;
  }

  return null;
}

/** Update Notion page properties. Wraps the SDK call so callers share one error-handling point. */
async function updateNotionPage(pageId: string, props: Record<string, unknown>): Promise<void> {
  await notionClient.pages.update({
    page_id: pageId,
    properties: props as NotionProps,
  });
}

/**
 * Append a timestamped entry to the "سجل المكالمات" rich-text property.
 * Fetches the current value first, then overwrites with the appended result.
 * Keeps the last 1950 chars to stay within Notion's 2000-char per-item limit.
 */
async function appendCallLog(pageId: string, entry: string): Promise<void> {
  const page = (await notionClient.pages.retrieve({ page_id: pageId })) as PageObjectResponse;
  const prop = page.properties['سجل المكالمات'];

  let existing = '';
  if (prop && prop.type === 'rich_text') {
    existing = prop.rich_text.map((t) => t.plain_text).join('');
  }

  const combined = existing ? `${existing}\n${entry}` : entry;
  const truncated = combined.slice(-1950);

  await notionClient.pages.update({
    page_id: pageId,
    properties: {
      'سجل المكالمات': { rich_text: [{ text: { content: truncated } }] },
    } as NotionProps,
  });
}

// ── Per-event handlers ────────────────────────────────────────────────────────

async function handleStateUpdated(pageId: string, event: ZRWebhookEnvelope): Promise<void> {
  const { data, occurredAt } = event;
  const stateName = data.state?.name ?? '';

  if (stateName && !KNOWN_STATE_NAMES.has(stateName.toLowerCase().trim())) {
    logger.warn('ZR webhook — unrecognized state name (add to KNOWN_STATE_NAMES if expected)', {
      stateName,
      trackingNumber: data.trackingNumber ?? 'unknown',
    });
  }

  const props: Record<string, unknown> = {
    'حالة التوصيل': { select: { name: stateName || 'Unknown' } },
    'آخر تحديث': { date: { start: occurredAt } },
  };

  if (data.isReturn === true) {
    props['إرجاع'] = { checkbox: true };
  }

  await updateNotionPage(pageId, props);
}

async function handleSituationCreated(pageId: string, event: ZRWebhookEnvelope): Promise<void> {
  const { data, occurredAt } = event;
  const situation = data.situation;
  if (!situation) return;

  const slug = situation.slug ?? '';
  const isCallAttempt = CALL_ATTEMPT_KEYWORDS.some((kw) => slug.toLowerCase().includes(kw));

  if (slug && !isCallAttempt) {
    logger.warn('ZR webhook — unrecognized situation slug (check live events to extend CALL_ATTEMPT_KEYWORDS)', {
      slug,
      situationName: situation.name,
      trackingNumber: data.trackingNumber ?? 'unknown',
    });
  }

  const props: Record<string, unknown> = {
    'آخر وضعية': { rich_text: [{ text: { content: situation.name.slice(0, 2000) } }] },
    'آخر تحديث': { date: { start: occurredAt } },
  };

  if (situation.description) {
    props['وصف الوضعية'] = {
      rich_text: [{ text: { content: situation.description.slice(0, 2000) } }],
    };
  }

  await updateNotionPage(pageId, props);

  if (isCallAttempt) {
    // Format: [YYYY-MM-DD HH:mm] situation name
    const ts = new Date(occurredAt).toISOString().slice(0, 16).replace('T', ' ');
    await appendCallLog(pageId, `[${ts}] ${situation.name}`);
  }
}

async function handleIsReturnUpdated(pageId: string, event: ZRWebhookEnvelope): Promise<void> {
  const { data, occurredAt } = event;
  const stateName = data.state?.name ?? '';

  const props: Record<string, unknown> = {
    'إرجاع': { checkbox: data.isReturn === true },
    'آخر تحديث': { date: { start: occurredAt } },
  };

  if (stateName) {
    props['حالة التوصيل'] = { select: { name: stateName } };
  }

  await updateNotionPage(pageId, props);
}

// ── Async processing ──────────────────────────────────────────────────────────

async function processEvent(svixId: string, event: ZRWebhookEnvelope): Promise<void> {
  const { data, eventType } = event;
  const trackingNumber = data.trackingNumber;
  const externalId = data.externalId;

  if (!trackingNumber && !externalId) {
    logger.warn('ZR webhook — event missing both trackingNumber and externalId, skipping', {
      svixId,
      eventType,
    });
    return;
  }

  // ── Notion lookup ─────────────────────────────────────────────────────────
  let page: PageObjectResponse | null = null;
  try {
    page = await findNotionPage(trackingNumber, externalId);
  } catch (err) {
    logger.error('ZR webhook — Notion lookup failed', {
      err,
      svixId,
      eventType,
      trackingNumber: trackingNumber ?? 'unknown',
    });
    return;
  }

  if (!page) {
    logger.warn('ZR webhook — no Notion page found for parcel (not created through our system?)', {
      svixId,
      eventType,
      trackingNumber: trackingNumber ?? 'unknown',
      externalId: externalId ?? 'unknown',
    });
    return;
  }

  const pageId = page.id;

  // ── Route by event type ───────────────────────────────────────────────────
  // `terminal` = this event reached a final outcome (success OR a permanent error
  // that a retry can't fix). Only terminal events are marked processed, so transient
  // failures (network/rate-limit) are left un-marked and get re-delivered by Svix.
  let notionSuccess = false;
  let terminal = false;
  try {
    if (eventType === 'parcel.state.updated') {
      await handleStateUpdated(pageId, event);
    } else if (eventType === 'parcel.state.situation.created') {
      await handleSituationCreated(pageId, event);
    } else if (eventType === 'parcel.isReturn.updated') {
      await handleIsReturnUpdated(pageId, event);
    } else {
      // Unknown event type is permanent — retrying won't grow a handler.
      logger.warn('ZR webhook — unknown event type, no handler registered', { svixId, eventType });
    }
    notionSuccess = true;
    terminal = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Missing-property / validation errors are permanent (schema issue): mark terminal
    // so we don't retry forever; the operator must add the property in Notion.
    if (
      message.includes('Could not find property') ||
      message.includes('property') ||
      message.includes('validation_error')
    ) {
      logger.warn(
        'ZR webhook — Notion property may not exist in database. Add the missing property to the Notion database schema.',
        { svixId, eventType, notionPageId: pageId, error: message },
      );
      terminal = true;
    } else {
      // Treat everything else (network, rate-limit, 5xx) as transient: leave un-marked
      // so Svix retries deliver it again.
      logger.error('ZR webhook — Notion update failed (will retry on redelivery)', {
        err,
        svixId,
        eventType,
        notionPageId: pageId,
      });
    }
  }

  if (terminal) markProcessed(svixId);

  logger.info('ZR webhook processing complete', {
    svixId,
    eventType,
    trackingNumber: trackingNumber ?? 'unknown',
    notionPageFound: true,
    notionUpdateSuccess: notionSuccess,
    markedProcessed: terminal,
  });
}

// ── Express router ────────────────────────────────────────────────────────────

export const zrWebhookRouter = Router();

zrWebhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const svixId = req.headers['svix-id'] as string | undefined;
  const svixTimestamp = req.headers['svix-timestamp'] as string | undefined;
  const svixSignature = req.headers['svix-signature'] as string | undefined;

  // ── 1. Guard: secret must be configured ──────────────────────────────────
  const webhookSecret = env.WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn('ZR webhook received but WEBHOOK_SECRET is not set — rejecting');
    res.status(401).send('Webhook secret not configured');
    return;
  }

  // ── 2. Guard: required Svix headers ──────────────────────────────────────
  if (!svixId || !svixTimestamp || !svixSignature) {
    logger.warn('ZR webhook rejected — missing Svix headers', {
      hasSvixId: Boolean(svixId),
      hasSvixTimestamp: Boolean(svixTimestamp),
      hasSvixSignature: Boolean(svixSignature),
    });
    res.status(401).send('Missing Svix headers');
    return;
  }

  // ── 3. Verify Svix signature ──────────────────────────────────────────────
  // Validates HMAC-SHA256, rejects timestamps outside ±5 min (replay protection),
  // and handles multiple comma-separated signatures in svix-signature.
  const wh = new Webhook(webhookSecret);
  let event: ZRWebhookEnvelope;
  try {
    const verified = wh.verify(req.body as Buffer, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
    event = verified as ZRWebhookEnvelope;
  } catch (err) {
    logger.error('ZR webhook — Svix signature verification failed', { err, svixId });
    res.status(401).send('Invalid signature');
    return;
  }

  // ── 4. Deduplicate (peek only — mark happens after successful processing) ──
  if (hasSeen(svixId)) {
    logger.warn('ZR webhook — duplicate svix-id, already processed', {
      svixId,
      eventType: event.eventType,
      trackingNumber: event.data.trackingNumber ?? 'unknown',
    });
    res.status(200).send('OK');
    return;
  }

  // ── 5. Acknowledge immediately (ZR/Svix timeout is 5 s) ──────────────────
  logger.info('ZR webhook received', {
    svixId,
    eventType: event.eventType,
    trackingNumber: event.data.trackingNumber ?? 'unknown',
    stateName: event.data.state?.name ?? 'none',
    situationSlug: event.data.situation?.slug ?? 'none',
  });
  res.status(200).send('OK');

  // ── 6. Process asynchronously ─────────────────────────────────────────────
  processEvent(svixId, event).catch((err) => {
    logger.error('ZR webhook — unhandled async error', {
      err,
      svixId,
      eventType: event.eventType,
    });
  });
});
