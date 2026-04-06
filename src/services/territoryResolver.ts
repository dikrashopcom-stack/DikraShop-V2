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

export async function resolveCommuneAndWilaya(
  communeName: string
): Promise<{ commune: ZRTerritory; wilayaId: string } | null> {
  const key = normalize(communeName);

  if (cache.has(key)) return cache.get(key) ?? null;

  logger.debug("Resolving commune from ZR", { commune: communeName });

  try {
    const res = await searchTerritories({ keyword: communeName, pageNumber: 1, pageSize: 20 });

    if (!res.items?.length) {
      logger.warn("No results for commune", { commune: communeName });
      cache.set(key, null);
      return null;
    }

    const n = normalize(communeName);
    // Priority: exact match → starts-with → contains
    const match =
      res.items.find((t) => t.level === "commune" && normalize(t.name) === n) ??
      res.items.find((t) => t.level === "commune" && normalize(t.name).startsWith(n)) ??
      res.items.find((t) => t.level === "commune" && normalize(t.name).includes(n));

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
