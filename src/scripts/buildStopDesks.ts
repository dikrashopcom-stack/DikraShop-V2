/**
 * build:stop-desks
 *
 * Reconciles hubs + territories + rates into enriched stop desk entries.
 *
 * Requires:
 *   npm run fetch:hubs
 *   npm run fetch:territories
 *   npm run fetch:rates
 *
 * Outputs:
 *   data/stop_desks_enriched.json  — all hubs enriched with territory + rate data
 *   data/territories_with_hubs.json — all territories annotated with their hub if found
 *
 * Matching strategy (applied in order, first match wins):
 *   Pass 1 — Direct ID:       hub.cityTerritoryId === rate.territoryId
 *   Pass 2 — Normalized name: normalize(hub.city) === normalize(territory.name)
 *   Pass 3 — Alias override:  data/hub_aliases.json maps hub.city → territory name
 *
 * Note: Pass 1 covers most cases since hubs embed territory UUIDs directly.
 */

import * as path from "path";
import "../utils/env";
import { logger } from "../utils/logger";
import { writeJson, readJson } from "../utils/file";
import {
  NormalizedHub, NormalizedTerritory, NormalizedRate,
  EnrichedStopDesk, ZRTerritory, ZRRate,
} from "../types/zr";

const DATA_DIR = path.resolve(__dirname, "../../data");

// ── String normalization for fuzzy matching ───────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")          // collapse whitespace
    .replace(/[''`]/g, "")         // strip apostrophes
    .replace(/[-–—]/g, " ")        // dashes → space
    .normalize("NFD")              // decompose accents
    .replace(/[\u0300-\u036f]/g, ""); // strip accent marks
}

// ── Load + validate inputs ────────────────────────────────────────────────────

function requireData<T>(filePath: string, label: string, script: string): T {
  const data = readJson<T>(filePath);
  if (!data) {
    console.error(`\n❌ ${label} not found. Run: ${script} first.\n`);
    process.exit(1);
  }
  return data;
}

async function main(): Promise<void> {
  logger.info("build:stop-desks — starting");

  const hubs        = requireData<NormalizedHub[]>(
    path.join(DATA_DIR, "hubs.json"),
    "data/hubs.json", "npm run fetch:hubs"
  );
  const territories = requireData<NormalizedTerritory[]>(
    path.join(DATA_DIR, "territories.json"),
    "data/territories.json", "npm run fetch:territories"
  );
  const rates       = requireData<NormalizedRate[]>(
    path.join(DATA_DIR, "rates.json"),
    "data/rates.json", "npm run fetch:rates"
  );
  const aliases     = readJson<Record<string, string>>(
    path.join(DATA_DIR, "hub_aliases.json")
  ) ?? {};

  logger.info(`Loaded: ${hubs.length} hubs | ${territories.length} territories | ${rates.length} rates | ${Object.keys(aliases).filter(k => !k.startsWith("_")).length} aliases`);

  // ── Build lookup indexes ──────────────────────────────────────────────────

  // Rates by territory ID
  const rateById = new Map<string, NormalizedRate>();
  for (const r of rates) rateById.set(r.territoryId, r);

  // Territories by ID
  const territoryById = new Map<string, NormalizedTerritory>();
  for (const t of territories) territoryById.set(t.id, t);

  // Territories by normalized name (for Pass 2)
  const territoryByNormName = new Map<string, NormalizedTerritory>();
  for (const t of territories) {
    const key = norm(t.name);
    if (!territoryByNormName.has(key)) territoryByNormName.set(key, t);
  }

  // Cleaned alias map (strip comment keys)
  const cleanAliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(aliases)) {
    if (!k.startsWith("_")) cleanAliases[k] = v;
  }

  // ── Match each hub to a territory + rate ─────────────────────────────────

  const stats = { directId: 0, normName: 0, alias: 0, unmatched: 0 };

  const enriched: EnrichedStopDesk[] = hubs.map((hub): EnrichedStopDesk => {
    let territory: NormalizedTerritory | null = null;
    let rate: NormalizedRate | null = null;
    let matchedBy: EnrichedStopDesk["matchedBy"] = "unmatched";

    // Pass 1 — direct ID via cityTerritoryId
    if (hub.cityTerritoryId) {
      territory = territoryById.get(hub.cityTerritoryId) ?? null;
      rate      = rateById.get(hub.cityTerritoryId) ?? null;
      if (territory || rate) {
        matchedBy = "direct-id";
        stats.directId++;
      }
    }

    // Pass 2 — normalized name match on hub.city → territory.name
    if (matchedBy === "unmatched" && hub.city) {
      const candidate = territoryByNormName.get(norm(hub.city)) ?? null;
      if (candidate) {
        territory = candidate;
        rate      = rateById.get(candidate.id) ?? null;
        matchedBy = "normalized-name";
        stats.normName++;
      }
    }

    // Pass 3 — alias override
    if (matchedBy === "unmatched" && cleanAliases[hub.city]) {
      const aliasedName = cleanAliases[hub.city];
      const candidate   = territoryByNormName.get(norm(aliasedName)) ?? null;
      if (candidate) {
        territory = candidate;
        rate      = rateById.get(candidate.id) ?? null;
        matchedBy = "alias";
        stats.alias++;
      }
    }

    if (matchedBy === "unmatched") {
      stats.unmatched++;
      logger.warn(`No match for hub: "${hub.name}" (city="${hub.city}", cityTerritoryId="${hub.cityTerritoryId}")`);
    }

    return {
      hubId:               hub.id,
      cityTerritoryId:     hub.cityTerritoryId,
      districtTerritoryId: hub.districtTerritoryId,
      name:                hub.name,
      city:                hub.city,
      district:            hub.district,
      street:              hub.street,
      postalCode:          hub.postalCode,
      coordinates:         hub.coordinates,
      openingHours:        hub.openingHours,
      phone1:              hub.phone1,
      phone2:              hub.phone2,
      homeDeliveryPrice:   rate?.homePrice        ?? null,
      pickupPointPrice:    rate?.pickupPointPrice ?? null,
      returnPrice:         rate?.returnPrice      ?? null,
      supportsHomeDelivery: territory?.hasHomeDelivery ?? false,
      supportsPickupPoint:  hub.isPickupPoint,
      matchedBy,
      rawHub:       hub.raw,
      rawTerritory: territory?.raw ?? null,
      rawRate:      rate?.raw      ?? null,
    };
  });

  logger.info(
    `Match results — directId: ${stats.directId} | normName: ${stats.normName} | alias: ${stats.alias} | unmatched: ${stats.unmatched}`
  );

  // ── territories_with_hubs: annotate every territory with its hub if found ─

  const hubByCityTerritoryId = new Map<string, NormalizedHub>();
  for (const hub of hubs) {
    if (hub.cityTerritoryId && !hubByCityTerritoryId.has(hub.cityTerritoryId)) {
      hubByCityTerritoryId.set(hub.cityTerritoryId, hub);
    }
  }

  const territoriesWithHubs = territories.map((t) => {
    const hub  = hubByCityTerritoryId.get(t.id) ?? null;
    const rate = rateById.get(t.id) ?? null;
    return {
      ...t,
      hubId:            hub?.id   ?? null,
      hubName:          hub?.name ?? null,
      hubStreet:        hub?.street ?? null,
      hubCity:          hub?.city ?? null,
      hubPhone1:        hub?.phone1 ?? null,
      hubOpeningHours:  hub?.openingHours ?? null,
      homeDeliveryPrice:  rate?.homePrice        ?? null,
      pickupPointPrice:   rate?.pickupPointPrice ?? null,
    };
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n📦 Enriched Stop Desks:\n");
  const withPrice = enriched.filter((e) => e.pickupPointPrice !== null && e.pickupPointPrice > 0);

  const tiers = new Map<number, string[]>();
  for (const e of withPrice) {
    const p = e.pickupPointPrice!;
    if (!tiers.has(p)) tiers.set(p, []);
    tiers.get(p)!.push(e.city);
  }
  for (const [price, cities] of [...tiers.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${price} DZD — ${[...new Set(cities)].join(", ")}`);
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  writeJson(path.join(DATA_DIR, "stop_desks_enriched.json"),   enriched);
  writeJson(path.join(DATA_DIR, "territories_with_hubs.json"), territoriesWithHubs);

  console.log("\n✅ Saved:");
  console.log("   data/stop_desks_enriched.json   — " + enriched.length          + " hubs with territory + rate data");
  console.log("   data/territories_with_hubs.json — " + territoriesWithHubs.length + " territories annotated with hub\n");

  if (stats.unmatched > 0) {
    console.log(`⚠️  ${stats.unmatched} hub(s) could not be matched. Check logs above and add entries to data/hub_aliases.json if needed.\n`);
  }
}

main().catch((err) => {
  logger.error("build:stop-desks failed", { err });
  process.exit(1);
});
