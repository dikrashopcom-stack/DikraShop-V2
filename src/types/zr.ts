// ZR Express API types — confirmed from official docs March 2026

// ── POST /parcels ─────────────────────────────────────────────────────────────

export interface ZRCreateParcelRequest {
  customer: {
    customerId: string;       // Random UUID is fine (docs confirmed)
    name: string;             // 2–100 chars
    phone: {
      number1: string;        // International format: +213XXXXXXXXX
      number2?: string;
    };
  };
  deliveryAddress: {
    cityTerritoryId: string;      // Wilaya UUID (commune.parentId)
    districtTerritoryId: string;  // Commune UUID from /territories/search
    street?: string;
  };
  orderedProducts: Array<{
    productName: string;      // Required — must NOT contain |
    unitPrice: number;        // Required
    quantity: number;         // Required
    stockType: "local" | "warehouse" | "none"; // Required
    productId?: string;       // Required if stockType = local/warehouse
    ProductSku?: string;      // Required if stockType = local/warehouse
    weight?: number;
    length?: number;
    width?: number;
    height?: number;
  }>;
  deliveryType: "home" | "pickup-point" | "return"; // Confirmed ZR enum
  description: string;        // 2–250 chars
  amount: number;             // Total amount ≤ 150,000 DZD
  hubId?: string;             // Required when deliveryType = "pickup-point"
  stateId?: string;           // Omit → OrderReceived; provide ReadyToDispatch UUID to skip
  externalId?: string;        // Your order number — max 100 chars, must be unique
  weight?: {
    weight: number;
    dimensionalWeight?: number;
  };
  hubStockId?: string;
}

// ZR returns 201 { id: "uuid" } on success
export interface ZRCreateParcelResponse {
  id: string;
  [key: string]: unknown;
}

// ── POST /parcels/labels/individual ──────────────────────────────────────────

export interface ZRGenerateLabelRequest {
  trackingNumbers: string[];
}

export interface ZRLabelResult {
  trackingNumber: string;
  fileUrl: string;
}

export interface ZRGenerateLabelResponse {
  labels?: ZRLabelResult[];
  succeeded?: ZRLabelResult[];
  failed?: string[];
  [key: string]: unknown;
}

// ── GET /parcels/{trackingNumber} ─────────────────────────────────────────────

export interface ZRGetParcelResponse {
  id?: string;
  trackingNumber?: string;
  status?: string;
  externalId?: string;
  [key: string]: unknown;
}

// ── POST /territories/search ──────────────────────────────────────────────────

export interface ZRTerritorySearchRequest {
  keyword?: string;
  pageNumber?: number;
  pageSize?: number;
}

// Confirmed shape from actual API response
export interface ZRTerritory {
  id: string;           // UUID — use as communeId / wilayaId
  code: number;
  name: string;
  postalCode: string;
  level: "commune" | "wilaya";
  parentId: string;     // For communes: UUID of the parent wilaya
  delivery: {
    hasHomeDelivery: boolean;
    hasPickupPoint: boolean;
  };
}

export interface ZRTerritorySearchResponse {
  items: ZRTerritory[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

// ── POST /hubs/search ─────────────────────────────────────────────────────────
// Confirmed schema from live response (April 2026)

export interface ZRHubAddress {
  street: string;
  city: string;
  cityTerritoryId: string;      // Wilaya UUID — direct link to territory
  district: string;
  districtTerritoryId: string;  // Commune UUID — direct link to territory
  postalCode: string;
  country: string;
  coordinates: {
    lat: number;
    lng: number;
  } | null;
}

export interface ZRHub {
  id: string;              // Hub UUID — use as hubId in pickup-point parcel creation
  name: string;            // Bilingual: "Hub Adrar 01 مكتب أدرار"
  type: string;            // Confirmed value: "sorting-center-hub"
  isPickupPoint: boolean;
  isVisible: boolean;
  address: ZRHubAddress;
  openingHours: string;    // e.g. "08:30-16:30"
  phone: {
    number1: string;
    number2: string;
    number3: string;
  };
  createdAt: string;
  paymentRequestEligibilityCutoffTime: string;
  paymentRequestEligibilityCutoffTimezoneId: string;
}

export interface ZRHubSearchRequest {
  keyword?: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface ZRHubSearchResponse {
  items: ZRHub[];
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface NormalizedHub {
  id: string;                    // Hub UUID — the hubId for parcel creation
  name: string;
  type: string;
  isPickupPoint: boolean;
  isVisible: boolean;
  city: string;                  // address.city
  district: string;              // address.district
  street: string;                // address.street
  postalCode: string;
  cityTerritoryId: string;       // Wilaya territory UUID (direct link)
  districtTerritoryId: string;   // Commune territory UUID (direct link)
  coordinates: { lat: number; lng: number } | null;
  openingHours: string;
  phone1: string;
  phone2: string;
  raw: ZRHub;
}

export interface EnrichedStopDesk {
  hubId: string;                 // Use this when creating pickup-point parcels
  cityTerritoryId: string;       // Wilaya UUID (from hub address)
  districtTerritoryId: string;   // Commune UUID (from hub address)
  name: string;
  city: string;
  district: string;
  street: string;
  postalCode: string;
  coordinates: { lat: number; lng: number } | null;
  openingHours: string;
  phone1: string;
  phone2: string;
  homeDeliveryPrice: number | null;
  pickupPointPrice: number | null;
  returnPrice: number | null;
  supportsHomeDelivery: boolean;
  supportsPickupPoint: boolean;
  matchedBy: "direct-id" | "normalized-name" | "alias" | "unmatched";
  rawHub: ZRHub;
  rawTerritory: ZRTerritory | null;
  rawRate: ZRRate | null;
}

// ── GET /delivery-pricing/rates ───────────────────────────────────────────────
// Confirmed from live response: single call returns all rates (Pattern A)

export interface ZRDeliveryPrice {
  deliveryType: "home" | "pickup-point" | "return";
  price: number;
  discountedPrice: number | null;
  isSpecificPrice: boolean;
  specificPriceId: string | null;
}

export interface ZRRate {
  toTerritoryId: string;
  toTerritoryName: string;
  toTerritoryLevel: string; // "commune" | "wilaya" — TODO: verify all possible values
  deliveryPrices: ZRDeliveryPrice[];
}

export interface ZRRatesResponse {
  rates: ZRRate[];
  // TODO: verify if pagination exists on this endpoint — not seen in live response
  [key: string]: unknown;
}

// ── Normalized / merged types (used in data output files) ────────────────────

export interface NormalizedTerritory {
  id: string;
  name: string;
  code: number;
  level: "commune" | "wilaya";
  postalCode: string;
  parentId: string;           // For communes: UUID of the parent wilaya
  hasHomeDelivery: boolean;
  hasPickupPoint: boolean;    // = stop desk availability
  raw: ZRTerritory;           // Preserved for forward-compatibility
}

export interface NormalizedRate {
  territoryId: string;
  territoryName: string;
  territoryLevel: string;
  homePrice: number | null;
  pickupPointPrice: number | null; // stop desk price
  returnPrice: number | null;
  raw: ZRRate;
}

export interface HubWithRate {
  id: string;
  name: string;
  code: number;
  level: "commune" | "wilaya";
  postalCode: string;
  parentId: string;
  hasHomeDelivery: boolean;
  hasPickupPoint: boolean;
  homeDeliveryPrice: number | null;
  pickupPointPrice: number | null;
  returnPrice: number | null;
  // TODO: ZR API does not expose physical stop desk addresses via API.
  // hubId for pickup-point parcels is not exposed — contact ZR support to get the hub UUID list.
  hubId: null;
  address: null;
  rawTerritory: ZRTerritory;
  rawRate: ZRRate | null;     // null if no rate found for this territory
}

// ── Error shape ────────────────────────────────────────────────────────────────

export interface ZRApiError {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  message?: string;
  errors?: Array<{ code: string; description: string; type: number }>;
}
