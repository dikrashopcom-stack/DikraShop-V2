/**
 * fetch:hubs
 *
 * Fetches all ZR Express hubs (stop desks / pickup points) with pagination,
 * normalizes the results, and saves to:
 *   data/hubs.json      — normalized array
 *   data/hubs_raw.json  — raw API items (for debugging / forward-compat)
 *
 * Key finding from live API (April 2026):
 *   - Endpoint: POST /hubs/search
 *   - Each hub includes address.cityTerritoryId (wilaya UUID) and
 *     address.districtTerritoryId (commune UUID) — direct links to territories
 *   - 92 hubs total at time of writing
 *   - All confirmed hubs have type = "sorting-center-hub"
 *   - hubId from this response is what goes into parcel creation for pickup-point delivery
 */

import * as path from "path";
import "../utils/env";
import { searchHubs } from "../clients/zr";
import { logger } from "../utils/logger";
import { writeJson } from "../utils/file";
import { ZRHub, NormalizedHub } from "../types/zr";

const DATA_DIR = path.resolve(__dirname, "../../data");
const PAGE_SIZE = 50;

function normalize(raw: ZRHub): NormalizedHub {
  return {
    id:                    raw.id,
    name:                  raw.name,
    type:                  raw.type,
    isPickupPoint:         raw.isPickupPoint,
    isVisible:             raw.isVisible,
    city:                  raw.address?.city        ?? "",
    district:              raw.address?.district    ?? "",
    street:                raw.address?.street      ?? "",
    postalCode:            raw.address?.postalCode  ?? "",
    cityTerritoryId:       raw.address?.cityTerritoryId     ?? "",
    districtTerritoryId:   raw.address?.districtTerritoryId ?? "",
    coordinates:           raw.address?.coordinates ?? null,
    openingHours:          raw.openingHours ?? "",
    phone1:                raw.phone?.number1 ?? "",
    phone2:                raw.phone?.number2 ?? "",
    raw,
  };
}

async function main(): Promise<void> {
  logger.info("fetch:hubs — starting");

  const allRaw: ZRHub[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    logger.info(`Fetching page ${page} of ${totalPages}`);

    const res = await searchHubs({ pageNumber: page, pageSize: PAGE_SIZE });

    const items = res.items ?? [];
    if (items.length === 0 && page === 1) {
      logger.warn("ZR returned 0 hubs on page 1 — check API credentials or endpoint");
    }

    allRaw.push(...items);

    totalPages = res.totalPages ?? 1;
    logger.info(`Page ${page}/${totalPages} — got ${items.length} hubs (total so far: ${allRaw.length}/${res.totalCount ?? "?"})`);

    page++;
  } while (page <= totalPages);

  logger.info(`Done fetching — total hubs: ${allRaw.length}`);

  const normalized: NormalizedHub[] = allRaw.map(normalize);

  // Stats
  const pickupPoints = normalized.filter((h) => h.isPickupPoint).length;
  const visible      = normalized.filter((h) => h.isVisible).length;
  const types        = [...new Set(normalized.map((h) => h.type))];

  logger.info(`Pickup points: ${pickupPoints} | Visible: ${visible} | Types: ${types.join(", ")}`);

  writeJson(path.join(DATA_DIR, "hubs.json"),     normalized);
  writeJson(path.join(DATA_DIR, "hubs_raw.json"), allRaw);

  console.log("\n✅ Saved:");
  console.log("   data/hubs.json     — " + normalized.length + " normalized hubs");
  console.log("   data/hubs_raw.json — raw API items");
  console.log("\n💡 Each hub includes hubId, address, phone, opening hours, and direct territory links.\n");
}

main().catch((err) => {
  logger.error("fetch:hubs failed", { err });
  process.exit(1);
});
