/**
 * fetch:territories
 *
 * Fetches ALL territories from the ZR Express API (handling pagination),
 * normalizes the results, and saves them to:
 *   data/territories.json  — normalized array
 *   data/territories_raw.json — raw API items (for debugging / forward-compat)
 */

import * as path from "path";
import "../utils/env";
import { searchTerritories } from "../clients/zr";
import { logger } from "../utils/logger";
import { writeJson } from "../utils/file";
import { ZRTerritory, NormalizedTerritory } from "../types/zr";

const DATA_DIR = path.resolve(__dirname, "../../data");
const PAGE_SIZE = 100; // Max per page — adjust if ZR imposes a lower limit

function normalize(raw: ZRTerritory): NormalizedTerritory {
  return {
    id:               raw.id,
    name:             raw.name,
    code:             raw.code,
    level:            raw.level,
    postalCode:       raw.postalCode,
    parentId:         raw.parentId,
    hasHomeDelivery:  raw.delivery?.hasHomeDelivery ?? false,
    hasPickupPoint:   raw.delivery?.hasPickupPoint  ?? false,
    raw,
  };
}

async function main(): Promise<void> {
  logger.info("fetch:territories — starting");

  const allRaw: ZRTerritory[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    logger.info(`Fetching page ${page} of ${totalPages}`);

    const res = await searchTerritories({ pageNumber: page, pageSize: PAGE_SIZE });

    // Defensive: ZR returns items array + pagination metadata
    const items = res.items ?? [];
    if (items.length === 0 && page === 1) {
      logger.warn("ZR returned 0 items on page 1 — check API credentials or endpoint");
    }

    allRaw.push(...items);

    totalPages = res.totalPages ?? 1;
    logger.info(`Page ${page}/${totalPages} — got ${items.length} items (total so far: ${allRaw.length}/${res.totalCount ?? "?"})`);

    page++;
  } while (page <= totalPages);

  logger.info(`Done fetching — total territories: ${allRaw.length}`);

  // Normalize
  const normalized: NormalizedTerritory[] = allRaw.map(normalize);

  // Stats
  const wilayas  = normalized.filter((t) => t.level === "wilaya").length;
  const communes = normalized.filter((t) => t.level === "commune").length;
  const withPickup = normalized.filter((t) => t.hasPickupPoint).length;
  const withHome   = normalized.filter((t) => t.hasHomeDelivery).length;

  logger.info(`Wilayas: ${wilayas} | Communes: ${communes} | With pickup point: ${withPickup} | With home delivery: ${withHome}`);

  // Save
  writeJson(path.join(DATA_DIR, "territories.json"),     normalized);
  writeJson(path.join(DATA_DIR, "territories_raw.json"), allRaw);

  console.log("\n✅ Saved:");
  console.log("   data/territories.json     — " + normalized.length + " normalized entries");
  console.log("   data/territories_raw.json — raw API items\n");
}

main().catch((err) => {
  logger.error("fetch:territories failed", { err });
  process.exit(1);
});
