/**
 * Money-path regression tests for the v2.5 review fixes.
 * Run with: npm test
 *
 * Uses Node's built-in test runner (node:test) — no extra dependencies.
 * Dummy env vars are set BEFORE any src import so the zod env schema (which
 * calls process.exit on missing vars) passes without a real .env.
 */
process.env.NODE_ENV = "test";
process.env.NOTION_TOKEN = process.env.NOTION_TOKEN ?? "test_notion_token_1234567890";
process.env.NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID ?? "test_database_id_1234567890";
process.env.ZR_API_KEY = process.env.ZR_API_KEY ?? "test_zr_api_key_1234567890";
process.env.ZR_TENANT_ID = process.env.ZR_TENANT_ID ?? "test_tenant_id_1234567890";

import { test } from "node:test";
import assert from "node:assert/strict";

import { mapOrderToZRPayload } from "../src/services/orderMapping";
import { pickCommune } from "../src/services/territoryResolver";
import { extensionForContentType } from "../src/services/labelService";
import { normalizePhone, isValidPhone } from "../src/services/orderValidation";
import { ValidatedOrder } from "../src/types/notionOrder";
import { ZRTerritory } from "../src/types/zr";

function baseOrder(overrides: Partial<ValidatedOrder> = {}): ValidatedOrder {
  return {
    notionPageId: "page-1",
    orderNumber: "#1001",
    customerName: "Test Customer",
    phone: "+213661234567",
    wilaya: "Alger",
    commune: "Bab Ezzouar",
    communeId: "commune-uuid",
    wilayaId: "wilaya-uuid",
    deliveryType: "home",
    totalAmount: 3200,
    codAmount: 3200,
    quantity: 1,
    unitPrice: 3200,
    productDescription: "Cadre Cadeau pour: Test",
    isCOD: true,
    hubId: null,
    ...overrides,
  };
}

// ── Fix #3: prepaid orders must NOT be charged again by the courier ──────────
test("prepaid order sends amount 0 to ZR (no double-charge)", () => {
  const order = baseOrder({ isCOD: false, codAmount: 0, totalAmount: 3200 });
  const payload = mapOrderToZRPayload(order);
  assert.equal(payload.amount, 0, "prepaid parcel must collect 0 cash");
});

test("COD order sends codAmount as the ZR collection amount", () => {
  const order = baseOrder({ isCOD: true, codAmount: 3200, totalAmount: 3200 });
  const payload = mapOrderToZRPayload(order);
  assert.equal(payload.amount, 3200);
});

// ── Fix #6: line-item value must be consistent with collected amount ─────────
test("unitPrice * quantity equals the collected amount for qty > 1", () => {
  const order = baseOrder({ quantity: 2, codAmount: 6400, totalAmount: 6400 });
  const payload = mapOrderToZRPayload(order);
  const line = payload.orderedProducts[0];
  assert.equal(line.quantity, 2);
  assert.equal(line.unitPrice * line.quantity, payload.amount);
});

test("quantity of 0 is coerced to 1 (no divide-by-zero)", () => {
  const order = baseOrder({ quantity: 0, codAmount: 3200 });
  const payload = mapOrderToZRPayload(order);
  assert.equal(payload.orderedProducts[0].quantity, 1);
  assert.ok(Number.isFinite(payload.orderedProducts[0].unitPrice));
});

// ── Fix #4: same-named communes in different wilayas must not misroute ───────
const dupItems: ZRTerritory[] = [
  { id: "w-algiers", code: 16, name: "Alger", postalCode: "16000", level: "wilaya", parentId: "", delivery: { hasHomeDelivery: true, hasPickupPoint: true } },
  { id: "w-oran", code: 31, name: "Oran", postalCode: "31000", level: "wilaya", parentId: "", delivery: { hasHomeDelivery: true, hasPickupPoint: true } },
  { id: "c-algiers", code: 1601, name: "Ouled Fayet", postalCode: "16000", level: "commune", parentId: "w-algiers", delivery: { hasHomeDelivery: true, hasPickupPoint: true } },
  { id: "c-oran", code: 3101, name: "Ouled Fayet", postalCode: "31000", level: "commune", parentId: "w-oran", delivery: { hasHomeDelivery: true, hasPickupPoint: true } },
];

test("pickCommune disambiguates duplicate commune by wilaya name", () => {
  const inOran = pickCommune(dupItems, "Ouled Fayet", "Oran");
  assert.equal(inOran?.id, "c-oran");

  const inAlgiers = pickCommune(dupItems, "Ouled Fayet", "Alger");
  assert.equal(inAlgiers?.id, "c-algiers");
});

test("pickCommune falls back to first match when wilaya not identifiable", () => {
  // No wilaya provided → any match acceptable, but must still return a commune.
  const anyMatch = pickCommune(dupItems, "Ouled Fayet");
  assert.ok(anyMatch && anyMatch.level === "commune");
});

test("pickCommune returns null when no commune matches", () => {
  assert.equal(pickCommune(dupItems, "Nonexistent Commune", "Alger"), null);
});

// ── Fix #7: labels must not be saved as .html when they are PDFs ─────────────
test("extensionForContentType defaults to .pdf and detects types", () => {
  assert.equal(extensionForContentType("application/pdf"), ".pdf");
  assert.equal(extensionForContentType(undefined), ".pdf");
  assert.equal(extensionForContentType("text/html; charset=utf-8"), ".html");
  assert.equal(extensionForContentType("image/png"), ".png");
});

// ── Phone normalization/validation guard (validation path) ───────────────────
test("normalizePhone and isValidPhone handle Algerian formats", () => {
  assert.equal(normalizePhone("0661 23 45 67"), "+213661234567");
  assert.equal(normalizePhone("661234567"), "+213661234567");
  assert.ok(isValidPhone("0661234567"));
  assert.ok(isValidPhone("0551234567"));
  assert.ok(isValidPhone("0771234567"));
  assert.ok(!isValidPhone("0123456789")); // invalid mobile prefix
  assert.ok(!isValidPhone("06612345"));   // too short
});
