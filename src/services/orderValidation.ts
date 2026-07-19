import * as path from "path";
import { NotionOrderRaw, ValidatedOrder } from "../types/notionOrder";
import { resolveCommuneAndWilaya } from "./territoryResolver";
import { logger } from "../utils/logger";
import { readJson } from "../utils/file";
import { EnrichedStopDesk } from "../types/zr";

const DATA_DIR = path.resolve(__dirname, "../../data");

function findHubIdForWilaya(wilayaId: string): string | null {
  const desks = readJson<EnrichedStopDesk[]>(path.join(DATA_DIR, "stop_desks_enriched.json"));
  if (!desks) {
    logger.warn("stop_desks_enriched.json not found — run: npm run fetch:all");
    return null;
  }
  const match = desks.find((d) => d.cityTerritoryId === wilayaId && d.supportsPickupPoint);
  if (!match) {
    logger.warn(`No pickup-point hub found for wilayaId "${wilayaId}"`);
    return null;
  }
  return match.hubId;
}

export function normalizePhone(phone: string): string {
  const s = phone.replace(/[\s\-\.]/g, "");
  if (s.startsWith("+213")) return s;
  if (s.startsWith("0") && s.length === 10) return "+213" + s.slice(1);
  if (s.length === 9) return "+213" + s;
  return s;
}

export function isValidPhone(phone: string): boolean {
  return /^\+213(5|6|7)\d{8}$/.test(normalizePhone(phone));
}

function mapDeliveryType(v: string | null): "home" | "pickup-point" | null {
  if (!v) return null;
  if (v.includes("المنزل")) return "home";
  if (v.includes("المكتب")) return "pickup-point";
  return null;
}

function buildDescription(order: NotionOrderRaw): string {
  // ZR description: "Cadre Cadeau pour: <name>"
  const name = order.الإسم_في_اللوحة?.trim() ?? order.اسم_صاحب_الطلبية?.trim() ?? "";
  const description = "Cadre Cadeau pour: " + name;
  // ZR requires 2–250 chars, no | characters
  return description.slice(0, 250);
}

export interface ValidationResult  { success: true;  order: ValidatedOrder; }
export interface ValidationFailure { success: false; errors: string[]; }

export async function validateOrder(raw: NotionOrderRaw): Promise<ValidationResult | ValidationFailure> {
  const errors: string[] = [];

  if (!raw.رقم_الطلب?.trim())           errors.push("رقم الطلب (Order number) is missing");
  if (!raw.اسم_صاحب_الطلبية?.trim())    errors.push("اسم صاحب الطلبية (Customer name) is missing");
  if (!raw.الهاتف?.trim())               errors.push("الهاتف (Phone) is missing");
  else if (!isValidPhone(raw.الهاتف))    errors.push("Phone invalid: " + raw.الهاتف + " — expected 05/06/07XXXXXXXX");
  if (!raw.البلدية?.trim())              errors.push("البلدية (Commune) is missing");
  if (!raw.نوع_التوصيل)                  errors.push("نوع التوصيل (Delivery type) is missing");

  if (raw.المبلغ_الإجمالي === null || raw.المبلغ_الإجمالي === undefined) {
    errors.push("المبلغ الإجمالي (Total amount) is missing");
  } else if (raw.المبلغ_الإجمالي > 150000) {
    errors.push("Amount " + raw.المبلغ_الإجمالي + " DZD exceeds ZR max of 150,000 DZD");
  }

  const deliveryType = mapDeliveryType(raw.نوع_التوصيل ?? null);
  if (raw.نوع_التوصيل && !deliveryType) {
    errors.push("Delivery type not recognized: " + raw.نوع_التوصيل);
  }

  if (errors.length > 0) return { success: false, errors };

  const territory = await resolveCommuneAndWilaya(raw.البلدية!.trim(), raw.الولاية);
  if (!territory) {
    return {
      success: false,
      errors: [
        "Commune \"" + raw.البلدية + "\" not found in ZR. " +
        "Try French spelling (e.g. Oran, Jijel, Alger). " +
        "Run: npm run territories -- " + raw.البلدية,
      ],
    };
  }

  const unitPrice = raw.سعر_اللوحة ?? raw.المبلغ_الإجمالي ?? 0;

  // Look up hub ID for pickup-point orders
  const hubId = deliveryType === "pickup-point"
    ? findHubIdForWilaya(territory.wilayaId)
    : null;

  if (deliveryType === "pickup-point" && !hubId) {
    return {
      success: false,
      errors: [
        `No pickup-point hub found for wilaya "${raw.الولاية ?? raw.البلدية}". ` +
        "Run: npm run fetch:all to refresh hub data, or switch delivery type to home.",
      ],
    };
  }

  const validated: ValidatedOrder = {
    notionPageId: raw.notionPageId,
    orderNumber:  raw.رقم_الطلب!.trim(),
    customerName: raw.اسم_صاحب_الطلبية!.trim(),
    phone:        normalizePhone(raw.الهاتف!.trim()),
    wilaya:       raw.الولاية ?? "",
    commune:      raw.البلدية!.trim(),
    communeId:    territory.commune.id,
    wilayaId:     territory.wilayaId,
    deliveryType: deliveryType!,
    totalAmount:  raw.المبلغ_الإجمالي ?? 0,
    codAmount:    raw.حالة_الدفع === "الدفع عند الإستلام" ? (raw.المبلغ_الإجمالي ?? 0) : 0,
    quantity:     raw.الكمية ?? 1,
    unitPrice,
    productDescription: buildDescription(raw),
    isCOD:        raw.حالة_الدفع === "الدفع عند الإستلام",
    hubId,
  };

  logger.debug("Validation passed", {
    orderId:   validated.orderNumber,
    communeId: territory.commune.id,
    wilayaId:  territory.wilayaId,
    commune:   territory.commune.name,
  });

  return { success: true, order: validated };
}
