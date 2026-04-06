import axios, { AxiosInstance, AxiosError } from "axios";
import { env } from "../utils/env";
import { logger } from "../utils/logger";
import {
  ZRCreateParcelRequest, ZRCreateParcelResponse,
  ZRGenerateLabelRequest, ZRGenerateLabelResponse,
  ZRGetParcelResponse, ZRTerritorySearchRequest,
  ZRTerritorySearchResponse, ZRRatesResponse,
  ZRHubSearchRequest, ZRHubSearchResponse, ZRApiError,
} from "../types/zr";

// Confirmed required headers from ZR docs:
//   X-Api-Key  → secret key
//   X-Tenant   → tenant ID (confirmed required by delivery-pricing docs)
const zrHttp: AxiosInstance = axios.create({
  baseURL: env.ZR_BASE_URL,
  timeout: 30_000,
  headers: {
    accept: "application/json",
    "Content-Type": "application/json",
    "X-Api-Key": env.ZR_API_KEY,
    "X-Tenant": env.ZR_TENANT_ID,
  },
});

zrHttp.interceptors.request.use((config) => {
  logger.debug("ZR → " + config.method?.toUpperCase() + " " + config.url);
  return config;
});

zrHttp.interceptors.response.use(
  (res) => { logger.debug("ZR ← " + res.status + " " + res.config.url); return res; },
  (err: AxiosError) => {
    // Log full raw response so we can debug any field issues
    logger.error("ZR API error", {
      status: String(err.response?.status),
      raw: JSON.stringify(err.response?.data ?? "").slice(0, 1000),
    });
    return Promise.reject(err);
  }
);

// Extract a human-readable error string from ZR response
export function extractZRError(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as ZRApiError | undefined;
    if (data?.errors?.length) return data.errors.map((e) => e.description).join(" | ");
    if (data?.detail) return data.detail;
    if (data?.message) return data.message;
    if (data?.title) return data.title + " (HTTP " + err.response?.status + ")";
    return "HTTP " + (err.response?.status ?? "?") + " — " + JSON.stringify(err.response?.data ?? "").slice(0, 300);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// POST /parcels
export async function createParcel(payload: ZRCreateParcelRequest): Promise<ZRCreateParcelResponse> {
  logger.info("Creating ZR parcel", { orderId: payload.externalId });
  logger.debug("Payload: " + JSON.stringify(payload, null, 2));
  const res = await zrHttp.post<ZRCreateParcelResponse>("/parcels", payload);
  logger.debug("Response: " + JSON.stringify(res.data));
  return res.data;
}

// POST /parcels/labels/individual
export async function generateIndividualLabel(trackingNumbers: string[]): Promise<ZRGenerateLabelResponse> {
  logger.info("Generating label", { trackingNumbers: trackingNumbers.join(",") });
  const payload: ZRGenerateLabelRequest = { trackingNumbers };
  const res = await zrHttp.post<ZRGenerateLabelResponse>("/parcels/labels/individual", payload);
  logger.debug("Label response: " + JSON.stringify(res.data));
  return res.data;
}

// GET /parcels/{trackingNumber}
export async function getParcelByTracking(trackingNumber: string): Promise<ZRGetParcelResponse> {
  const res = await zrHttp.get<ZRGetParcelResponse>("/parcels/" + encodeURIComponent(trackingNumber));
  return res.data;
}

// POST /territories/search
export async function searchTerritories(params: ZRTerritorySearchRequest): Promise<ZRTerritorySearchResponse> {
  const res = await zrHttp.post<ZRTerritorySearchResponse>("/territories/search", params);
  return res.data;
}

// GET /delivery-pricing/rates
// Confirmed (live): returns all rates in a single call — no pagination needed.
export async function getDeliveryRates(): Promise<unknown> {
  const res = await zrHttp.get("/delivery-pricing/rates");
  return res.data;
}

// Typed version for data pipeline scripts
export async function getAllRates(): Promise<ZRRatesResponse> {
  const res = await zrHttp.get<ZRRatesResponse>("/delivery-pricing/rates");
  return res.data;
}

// POST /hubs/search — confirmed from live API (April 2026), supports pagination
export async function searchHubs(params: ZRHubSearchRequest): Promise<ZRHubSearchResponse> {
  const res = await zrHttp.post<ZRHubSearchResponse>("/hubs/search", params);
  return res.data;
}

// PATCH /parcels/{parcelId}/state
export async function updateParcelState(parcelId: string, newStateId: string, comment?: string): Promise<unknown> {
  const res = await zrHttp.patch("/parcels/" + parcelId + "/state", { parcelId, newStateId, comment: comment ?? "" });
  return res.data;
}
