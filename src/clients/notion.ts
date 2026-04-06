import { Client } from "@notionhq/client";
import { PageObjectResponse, QueryDatabaseParameters } from "@notionhq/client/build/src/api-endpoints";
import { env } from "../utils/env";
import { logger } from "../utils/logger";
import { NotionOrderRaw, ShipmentStatus } from "../types/notionOrder";

const notion = new Client({ auth: env.NOTION_TOKEN });

// ── Property helpers ──────────────────────────────────────────────────────────

function getText(page: PageObjectResponse, name: string): string | null {
  const p = page.properties[name];
  if (!p) return null;
  if (p.type === "title") return p.title.map((t) => t.plain_text).join("") || null;
  if (p.type === "rich_text") return p.rich_text.map((t) => t.plain_text).join("") || null;
  if (p.type === "phone_number") return p.phone_number ?? null;
  if (p.type === "url") return p.url ?? null;
  return null;
}

function getNumber(page: PageObjectResponse, name: string): number | null {
  const p = page.properties[name];
  if (!p || p.type !== "number") return null;
  return p.number ?? null;
}

function getSelect(page: PageObjectResponse, name: string): string | null {
  const p = page.properties[name];
  if (!p || p.type !== "select") return null;
  return p.select?.name ?? null;
}

function getDate(page: PageObjectResponse, name: string): string | null {
  const p = page.properties[name];
  if (!p || p.type !== "date") return null;
  return p.date?.start ?? null;
}

function getCheckbox(page: PageObjectResponse, name: string): boolean {
  const p = page.properties[name];
  if (!p || p.type !== "checkbox") return false;
  return p.checkbox;
}

// ── Map Notion page → NotionOrderRaw ─────────────────────────────────────────

export function mapPageToOrder(page: PageObjectResponse): NotionOrderRaw {
  return {
    notionPageId: page.id,
    رقم_الطلب: getText(page, "رقم الطلب"),
    اسم_صاحب_الطلبية: getText(page, "اسم صاحب الطلبية"),
    الهاتف: getText(page, "الهاتف"),
    الولاية: getSelect(page, "الولاية"),
    البلدية: getText(page, "البلدية"),
    نوع_التوصيل: getSelect(page, "نوع التوصيل") as NotionOrderRaw["نوع_التوصيل"],
    المبلغ_الإجمالي: getNumber(page, " المبلغ الإجمالي"),
    الكمية: getNumber(page, "الكمية"),
    ملاحظات_الطلب: getText(page, "ملاحظات الطلب"),
    حالة_الدفع: getSelect(page, "حالة الدفع") as NotionOrderRaw["حالة_الدفع"],
    مصاريف_التوصيل: getNumber(page, "مصاريف التوصيل"),
    سعر_اللوحة: getNumber(page, "سعر اللوحة"),
    الإسم_في_اللوحة: getText(page, "الإسم في اللوحة"),
    العبارة_في_اللوحة: getText(page, "العبارة في اللوحة"),
    لون_الخلفية: getSelect(page, "لون الخلفية"),
    لون_الإطار: getSelect(page, "لون الإطار"),
    لون_الفويل: getSelect(page, "لون الفويل"),
    // Moon design fields — TODO: verify these property names match your Notion database
    تاريخ_الحدث: getDate(page, "تاريخ الحدث"),
    الخط: getSelect(page, "الخط"),
    Generated_Design_Path: getText(page, "Generated Design Path"),
    جاهز_للشحن: getCheckbox(page, "🚀 جاهز للشحن"),
    ZR_Parcel_ID: getText(page, "ZR Parcel ID"),
    رقم_التتبع: getText(page, "رقم التتبع"),
    Label_URL: getText(page, "Label URL"),
    حالة_الشحن: getSelect(page, "حالة الشحن") as NotionOrderRaw["حالة_الشحن"],
    ZR_Error: getText(page, "ZR Error"),
    Last_Sync_At: null,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function fetchReadyOrders(): Promise<NotionOrderRaw[]> {
  logger.info("Fetching ready-to-ship orders");
  const filter: QueryDatabaseParameters["filter"] = {
    and: [
      { property: "🚀 جاهز للشحن", checkbox: { equals: true } },
      { property: "رقم التتبع", rich_text: { is_empty: true } },
      { property: "ZR Parcel ID", rich_text: { is_empty: true } },
    ],
  };
  const res = await notion.databases.query({ database_id: env.NOTION_DATABASE_ID, filter, page_size: env.BATCH_SIZE });
  const orders = (res.results as PageObjectResponse[]).map(mapPageToOrder);
  logger.info("Found " + orders.length + " order(s) ready to ship");
  return orders;
}

export async function fetchFailedOrders(): Promise<NotionOrderRaw[]> {
  logger.info("Fetching failed orders for retry");
  const filter: QueryDatabaseParameters["filter"] = {
    and: [
      { property: "🚀 جاهز للشحن", checkbox: { equals: true } },
      { property: "حالة الشحن", select: { equals: "❌ Failed" } },
      { property: "ZR Parcel ID", rich_text: { is_empty: true } },
    ],
  };
  const res = await notion.databases.query({ database_id: env.NOTION_DATABASE_ID, filter, page_size: env.BATCH_SIZE });
  const orders = (res.results as PageObjectResponse[]).map(mapPageToOrder);
  logger.info("Found " + orders.length + " failed order(s) to retry");
  return orders;
}

export async function fetchOrderByPageId(pageId: string): Promise<NotionOrderRaw | null> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    if (page.object === "page" && "properties" in page) {
      return mapPageToOrder(page as PageObjectResponse);
    }
    return null;
  } catch (err) {
    logger.error("Failed to fetch Notion page", { notionPageId: pageId, err });
    return null;
  }
}

// ── Write-backs ───────────────────────────────────────────────────────────────

export interface ShipmentWriteBack {
  shipmentStatus: ShipmentStatus;
  zrParcelId?: string;
  trackingNumber?: string;
  labelUrl?: string;
  errorMessage?: string;
}

export async function writeShipmentResult(pageId: string, result: ShipmentWriteBack): Promise<void> {
  logger.debug("Writing result to Notion", { notionPageId: pageId, status: result.shipmentStatus });

  type NotionProps = Parameters<typeof notion.pages.update>[0]["properties"];
  const props: Record<string, unknown> = {
    "حالة الشحن": { select: { name: result.shipmentStatus } },
    "Last Sync At": { date: { start: new Date().toISOString() } },
    "ZR Error": { rich_text: result.errorMessage ? [{ text: { content: result.errorMessage.slice(0, 2000) } }] : [] },
  };

  if (result.zrParcelId !== undefined) {
    props["ZR Parcel ID"] = { rich_text: [{ text: { content: result.zrParcelId } }] };
  }
  if (result.trackingNumber !== undefined) {
    props["رقم التتبع"] = { rich_text: [{ text: { content: result.trackingNumber } }] };
  }
  if (result.labelUrl !== undefined) {
    props["Label URL"] = { url: result.labelUrl };
  }

  await notion.pages.update({ page_id: pageId, properties: props as NotionProps });
  logger.info("Notion updated", { notionPageId: pageId, status: result.shipmentStatus });
}

// ── Shopify → Notion ──────────────────────────────────────────────────────────

export interface ShopifyOrderPayload {
  id: number;
  order_number: number;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  financial_status: string;
  total_price: string;
  note: string | null;
  note_attributes?: Array<{ name: string; value: string }>;
  customer?: { first_name?: string; last_name?: string; phone?: string };
  shipping_address?: {
    name?: string;
    phone?: string;
    city?: string;
    province?: string;
  };
  line_items?: Array<{
    name: string;
    quantity: number;
    price: string;
    properties?: Array<{ name: string; value: string }>;
  }>;
  shipping_lines?: Array<{ price: string }>;
}

function getOrderProp(order: ShopifyOrderPayload, key: string): string | null {
  const fromLineItem = order.line_items?.[0]?.properties ?? [];
  const fromNoteAttrs = order.note_attributes ?? [];
  return (
    fromLineItem.find((p) => p.name === key)?.value ??
    fromNoteAttrs.find((p) => p.name === key)?.value ??
    null
  );
}

function mapPaymentStatus(order: ShopifyOrderPayload): string {
  if (order.financial_status === "paid") return "تم الدفع عن طريق BaridiMob";
  return "الدفع عند الإستلام";
}

export async function createOrderFromShopify(order: ShopifyOrderPayload): Promise<string> {
  const customerName =
    order.shipping_address?.name ??
    [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ??
    "—";

  const phone =
    order.shipping_address?.phone ?? order.customer?.phone ?? order.phone ?? null;

  const totalQuantity = (order.line_items ?? []).reduce((sum, i) => sum + i.quantity, 0);

  const itemPrice = order.line_items?.[0]?.price ? parseFloat(order.line_items[0].price) : null;
  const shippingPrice = order.shipping_lines?.[0]?.price ? parseFloat(order.shipping_lines[0].price) : null;
  const rawEventDate = getOrderProp(order, "تاريخ ميلاد صاحب الهدية");
  const eventDate = rawEventDate
    ? rawEventDate.split("/").reverse().join("-") // DD/MM/YYYY → YYYY-MM-DD
    : null;

  logger.debug("Order attributes received", { noteAttrs: order.note_attributes, lineItemProps: order.line_items?.[0]?.properties });

  const properties: Record<string, unknown> = {
    "رقم الطلب": { title: [{ text: { content: `#${order.order_number}` } }] },
    "اسم صاحب الطلبية": { rich_text: [{ text: { content: customerName } }] },
    ...(phone ? { "الهاتف": { phone_number: phone } } : {}),
    ...(order.shipping_address?.province
      ? { "الولاية": { select: { name: order.shipping_address.province } } }
      : {}),
    ...(order.shipping_address?.city
      ? { "البلدية": { rich_text: [{ text: { content: order.shipping_address.city } }] } }
      : {}),
    "نوع التوصيل": { select: { name: "المنزل 🏠" } },
    " المبلغ الإجمالي": { number: parseFloat(order.total_price) },
    "الكمية": { number: totalQuantity },
    "حالة الدفع": { select: { name: mapPaymentStatus(order) } },
    ...(itemPrice !== null ? { "سعر اللوحة": { number: itemPrice } } : {}),
    ...(shippingPrice !== null ? { "مصاريف التوصيل": { number: shippingPrice } } : {}),
    ...(order.note ? { "ملاحظات الطلب": { rich_text: [{ text: { content: order.note } }] } } : {}),
    // Custom frame fields from Shopify line item properties (if present)
    ...(getOrderProp(order, "إسم صاحب الهدية")
      ? { "الإسم في اللوحة": { rich_text: [{ text: { content: getOrderProp(order, "إسم صاحب الهدية")! } }] } }
      : {}),
    ...(getOrderProp(order, "رسالة صغيرة (إختياري)")
      ? { "العبارة في اللوحة": { rich_text: [{ text: { content: getOrderProp(order, "رسالة صغيرة (إختياري)")! } }] } }
      : {}),
    ...(getOrderProp(order, "لون الخلفية")
      ? { "لون الخلفية": { select: { name: getOrderProp(order, "لون الخلفية")! } } }
      : {}),
    ...(getOrderProp(order, "لون الإطار")
      ? { "لون الإطار": { select: { name: getOrderProp(order, "لون الإطار")! } } }
      : {}),
    ...(getOrderProp(order, "لون الفويل")
      ? { "لون الفويل": { select: { name: getOrderProp(order, "لون الفويل")! } } }
      : {}),
    ...(eventDate ? { "تاريخ الحدث": { date: { start: eventDate } } } : {}),
  };

  type NotionProps = Parameters<typeof notion.pages.create>[0]["properties"];
  const page = await notion.pages.create({
    parent: { database_id: env.NOTION_DATABASE_ID },
    properties: properties as NotionProps,
  });

  logger.info("Shopify order added to Notion", { orderId: order.id, orderNumber: order.order_number, pageId: page.id });
  return page.id;
}

// ── Moon design write-back ─────────────────────────────────────────────────

export interface DesignWriteBack {
  outputPath: string;   // absolute local path to the generated PNG
  moonPhase: string;    // raw phase name from the API
}

/**
 * Writes the generated design result back to the Notion page:
 *  - Updates the "Generated Design Path" rich-text property with the local file path
 *  - Appends an info block to the page body so it's visible when you open the page
 *
 * TODO: once you have a CDN / public URL for the image, swap the paragraph block
 *       for an image block using notion.blocks.children.append with type "image".
 */
export async function appendDesignResult(pageId: string, result: DesignWriteBack): Promise<void> {
  logger.debug("Writing design result to Notion", { notionPageId: pageId, outputPath: result.outputPath });

  // 1. Update the "Generated Design Path" property (rich text)
  //    TODO: rename "Generated Design Path" if your Notion property has a different name
  type NotionProps = Parameters<typeof notion.pages.update>[0]["properties"];
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Generated Design Path": {
        rich_text: [{ text: { content: result.outputPath.slice(0, 2000) } }],
      },
    } as NotionProps,
  });

  // 2. Append an info callout block so it's visible in the page body
  await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        type: "divider",
        divider: {},
      } as Parameters<typeof notion.blocks.children.append>[0]["children"][number],
      {
        type: "callout",
        callout: {
          rich_text: [
            {
              type: "text",
              text: {
                content: `🌙 Moon Design Generated\nPhase: ${result.moonPhase}\nFile: ${result.outputPath}`,
              },
            },
          ],
          icon: { type: "emoji", emoji: "🌙" },
          color: "blue_background",
        },
      } as Parameters<typeof notion.blocks.children.append>[0]["children"][number],
    ],
  });

  logger.info("Design result written to Notion", { notionPageId: pageId, moonPhase: result.moonPhase });
}

export async function markAsProcessing(pageId: string): Promise<void> {
  type NotionProps = Parameters<typeof notion.pages.update>[0]["properties"];
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "حالة الشحن": { select: { name: "⏳ Processing" } },
      "Last Sync At": { date: { start: new Date().toISOString() } },
    } as NotionProps,
  });
}
