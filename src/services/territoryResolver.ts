import { searchTerritories } from "../clients/zr";
import { ZRTerritory } from "../types/zr";
import { logger } from "../utils/logger";

// In-memory cache per process run
const cache = new Map<string, { commune: ZRTerritory; wilayaId: string } | null>();

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-–—]/g, " ")   // hyphens/dashes → space so "El-Oued" matches "El Oued"
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pure commune-selection logic (no I/O) — pulled out so it can be unit-tested.
 * Given ZR search items, picks the commune matching `communeName`, constrained to
 * the wilaya named `wilayaName` when it's provided and identifiable in the items.
 * This is what prevents same-named communes in different wilayas from misrouting.
 */
export function pickCommune(
  items: ZRTerritory[],
  communeName: string,
  wilayaName?: string | null,
): ZRTerritory | null {
  const n = normalize(communeName);
  const wn = wilayaName ? normalize(wilayaName) : "";

  const matchingWilayaIds = wn
    ? new Set(
        items
          .filter((t) => t.level === "wilaya" && normalize(t.name) === wn)
          .map((t) => t.id),
      )
    : null;

  const inWilaya = (t: ZRTerritory) =>
    !matchingWilayaIds || matchingWilayaIds.size === 0 || matchingWilayaIds.has(t.parentId);

  const communes = items.filter((t) => t.level === "commune" && inWilaya(t));
  return (
    communes.find((t) => normalize(t.name) === n) ??
    communes.find((t) => normalize(t.name).startsWith(n)) ??
    communes.find((t) => normalize(t.name).includes(n)) ??
    null
  );
}

export async function resolveCommuneAndWilaya(
  communeName: string,
  wilayaName?: string | null
): Promise<{ commune: ZRTerritory; wilayaId: string } | null> {
  // Cache key includes the wilaya: Algeria has duplicate commune names across
  // wilayas (e.g. "Ouled ...", "Sidi ..."), so keying on commune alone would
  // cache — and misroute — the first-seen wilaya's commune for all of them.
  const wn = wilayaName ? normalize(wilayaName) : "";
  const key = normalize(communeName) + "|" + wn;

  if (cache.has(key)) return cache.get(key) ?? null;

  logger.debug("Resolving commune from ZR", { commune: communeName, wilaya: wilayaName ?? "(any)" });

  try {
    const res = await searchTerritories({ keyword: communeName, pageNumber: 1, pageSize: 20 });

    if (!res.items?.length) {
      logger.warn("No results for commune", { commune: communeName });
      cache.set(key, null);
      return null;
    }

    // Disambiguate same-named communes across wilayas (pure logic, unit-tested).
    const match = pickCommune(res.items, communeName, wilayaName);

    if (!match) {
      logger.warn("No commune match", { commune: communeName, candidates: res.items.slice(0, 5).map((t) => t.name) });
      cache.set(key, null);
      return null;
    }

    const result = { commune: match, wilayaId: match.parentId };
    cache.set(key, result);

    logger.debug("Commune resolved", {
      input: communeName,
      resolved: match.name,
      communeId: match.id,
      wilayaId: match.parentId,
    });

    return result;
  } catch (err) {
    logger.error("Territory search failed", { commune: communeName, err });
    return null;
  }
}
