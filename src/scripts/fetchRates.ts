/**
 * fetch:rates
 *
 * Fetches delivery pricing from ZR Express and saves to:
 *   data/rates.json      — normalized array
 *   data/rates_raw.json  — raw API response (for debugging / forward-compat)
 *
 * Confirmed from live API: GET /delivery-pricing/rates returns all rates
 * in a single response (Pattern A — no per-territory loop needed).
 *
 * TODO: If ZR changes to per-territory pricing (Pattern B), swap to looping
 *       over territory IDs from data/territories.json using:
 *       GET /delivery-pricing/rates/{toTerritoryId}
 */

import * as path from "path";
import "../utils/env";
import { getAllRates } from "../clients/zr";
import { logger } from "../utils/logger";
import { writeJson } from "../utils/file";
import { ZRRate, NormalizedRate } from "../types/zr";

const DATA_DIR = path.resolve(__dirname, "../../data");

function normalize(raw: ZRRate): NormalizedRate {
  const prices = raw.deliveryPrices ?? [];

  const homePrice        = prices.find((p) => p.deliveryType === "home")?.price         ?? null;
  const pickupPointPrice = prices.find((p) => p.deliveryType === "pickup-point")?.price ?? null;
  const returnPrice      = prices.find((p) => p.deliveryType === "return")?.price       ?? null;

  return {
    territoryId:    raw.toTerritoryId,
    territoryName:  raw.toTerritoryName,
    territoryLevel: raw.toTerritoryLevel,
    homePrice,
    pickupPointPrice,
    returnPrice,
    raw,
  };
}

async function main(): Promise<void> {
  logger.info("fetch:rates — starting");

  const response = await getAllRates();

  // Defensive: confirm expected shape
  if (!Array.isArray(response.rates)) {
    logger.error("Unexpected response shape — 'rates' array not found", { keys: Object.keys(response) });
    process.exit(1);
  }

  const rawRates: ZRRate[] = response.rates;
  logger.info(`Received ${rawRates.length} rate entries from ZR`);

  const normalized: NormalizedRate[] = rawRates.map(normalize);

  // Stats
  const withHome    = normalized.filter((r) => r.homePrice        !== null).length;
  const withPickup  = normalized.filter((r) => r.pickupPointPrice !== null).length;
  const withReturn  = normalized.filter((r) => r.returnPrice      !== null).length;

  logger.info(`Rates with home price: ${withHome} | pickup-point: ${withPickup} | return: ${withReturn}`);

  // Price range summary
  const pickupPrices = normalized.map((r) => r.pickupPointPrice).filter((p): p is number => p !== null);
  const homePrices   = normalized.map((r) => r.homePrice).filter((p): p is number => p !== null);

  if (pickupPrices.length > 0) {
    logger.info(`Stop desk price range: ${Math.min(...pickupPrices)} – ${Math.max(...pickupPrices)} DZD`);
  }
  if (homePrices.length > 0) {
    logger.info(`Home delivery price range: ${Math.min(...homePrices)} – ${Math.max(...homePrices)} DZD`);
  }

  // Save
  writeJson(path.join(DATA_DIR, "rates.json"),     normalized);
  writeJson(path.join(DATA_DIR, "rates_raw.json"), response);

  console.log("\n✅ Saved:");
  console.log("   data/rates.json     — " + normalized.length + " normalized rate entries");
  console.log("   data/rates_raw.json — raw API response\n");
}

main().catch((err) => {
  logger.error("fetch:rates failed", { err });
  process.exit(1);
});
