/**
 * build:hub-map
 *
 * Merges data/territories.json + data/rates.json into:
 *   data/hubs_with_rates.json — full enriched dataset
 *   data/stop_desks.json      — only territories with pickup-point support + pricing
 *
 * Requires both fetch:territories and fetch:rates to have run first.
 *
 * KNOWN LIMITATION:
 *   ZR API does not expose physical stop desk addresses or hubId values.
 *   hubId is required when creating pickup-point parcels (deliveryType: "pickup-point").
 *   Contact ZR support to get the hub UUID list — then add them to a local lookup file.
 *   See: TODO in HubWithRate type in src/types/zr.ts
 */

import * as path from "path";
import "../utils/env";
import { logger } from "../utils/logger";
import { writeJson, readJson } from "../utils/file";
import { NormalizedTerritory, NormalizedRate, HubWithRate } from "../types/zr";

const DATA_DIR = path.resolve(__dirname, "../../data");

async function main(): Promise<void> {
  logger.info("build:hub-map — starting");

  // ── Load territories ──────────────────────────────────────────────────────
  const territories = readJson<NormalizedTerritory[]>(path.join(DATA_DIR, "territories.json"));
  if (!territories) {
    console.error("\n❌ data/territories.json not found. Run: npm run fetch:territories first.\n");
    process.exit(1);
  }
  logger.info(`Loaded ${territories.length} territories`);

  // ── Load rates ────────────────────────────────────────────────────────────
  const rates = readJson<NormalizedRate[]>(path.join(DATA_DIR, "rates.json"));
  if (!rates) {
    console.error("\n❌ data/rates.json not found. Run: npm run fetch:rates first.\n");
    process.exit(1);
  }
  logger.info(`Loaded ${rates.length} rates`);

  // ── Build rate lookup map ─────────────────────────────────────────────────
  const rateByTerritoryId = new Map<string, NormalizedRate>();
  for (const rate of rates) {
    rateByTerritoryId.set(rate.territoryId, rate);
  }

  // ── Merge ─────────────────────────────────────────────────────────────────
  let matched   = 0;
  let unmatched = 0;

  const merged: HubWithRate[] = territories.map((t) => {
    const rate = rateByTerritoryId.get(t.id) ?? null;
    if (rate) matched++; else unmatched++;

    return {
      id:                 t.id,
      name:               t.name,
      code:               t.code,
      level:              t.level,
      postalCode:         t.postalCode,
      parentId:           t.parentId,
      hasHomeDelivery:    t.hasHomeDelivery,
      hasPickupPoint:     t.hasPickupPoint,
      homeDeliveryPrice:  rate?.homePrice        ?? null,
      pickupPointPrice:   rate?.pickupPointPrice ?? null,
      returnPrice:        rate?.returnPrice      ?? null,
      // TODO: populate hubId once ZR provides the hub UUID list
      hubId:    null,
      // TODO: populate address once ZR exposes physical stop desk data
      address:  null,
      rawTerritory: t.raw,
      rawRate:      rate?.raw ?? null,
    };
  });

  logger.info(`Merge complete — matched: ${matched} | unmatched (no rate): ${unmatched}`);

  // ── Stop desks only ───────────────────────────────────────────────────────
  const stopDesks = merged.filter((h) => h.hasPickupPoint);
  logger.info(`Stop desks (hasPickupPoint=true): ${stopDesks.length}`);

  const stopDesksWithPrice = stopDesks.filter((h) => h.pickupPointPrice !== null);
  logger.info(`Stop desks with pricing data: ${stopDesksWithPrice.length}`);

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log("\n📦 Stop Desks by price tier:\n");
  const priceTiers = new Map<number, string[]>();
  for (const sd of stopDesksWithPrice) {
    const price = sd.pickupPointPrice!;
    if (!priceTiers.has(price)) priceTiers.set(price, []);
    priceTiers.get(price)!.push(sd.name);
  }
  for (const [price, names] of [...priceTiers.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${price} DZD → ${names.join(", ")}`);
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  writeJson(path.join(DATA_DIR, "hubs_with_rates.json"), merged);
  writeJson(path.join(DATA_DIR, "stop_desks.json"),      stopDesks);

  console.log("\n✅ Saved:");
  console.log("   data/hubs_with_rates.json — " + merged.length    + " territories (all) with pricing");
  console.log("   data/stop_desks.json      — " + stopDesks.length  + " stop desk locations\n");
}

main().catch((err) => {
  logger.error("build:hub-map failed", { err });
  process.exit(1);
});
