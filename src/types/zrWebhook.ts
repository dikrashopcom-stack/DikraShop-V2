export type ZREventType =
  | 'parcel.state.updated'
  | 'parcel.state.situation.created'
  | 'parcel.isReturn.updated';

export interface ZRWebhookEnvelope {
  eventType: ZREventType;
  occurredAt: string; // ISO 8601 UTC
  data: ParcelWebhookDto;
}

export interface ParcelWebhookDto {
  id: string; // UUID — always present
  trackingNumber?: string;
  externalId?: string;
  customer?: ParcelCustomerDto;
  supplier?: ParcelSupplierDto;
  deliveryAddress?: ParcelAddressDto;
  createdAt?: string;
  amount?: number;
  deliveryPrice?: number;
  returnPrice?: string; // Note: string, not number — ZR API quirk
  paymentMethod?: string;
  deliveryType?: string;
  weight?: WeightDto;
  state?: StateDto;
  lastStateSituationId?: string;
  situation?: SituationDto;
  lastStateUpdateAt?: string;
  lastSituationUpdateAt?: string;
  productsDescription?: string;
  productsStockType?: string;
  isReturn?: boolean;
  type?: string;
  isExchanged?: boolean;
  hasActiveModificationRequest?: boolean;
}

export interface ParcelCustomerDto {
  customerId: string;
  name: string;
  phone: PhoneDto;
}

export interface PhoneDto {
  countryCode: string;
  number: string;
}

export interface ParcelSupplierDto {
  supplierName: string;
  supplierCityTerritoryId: string;
  supplierHubId: string;
  supplierHubCityTerritoryId: string;
  supplierHubName: string;
  phone: PhoneDto;
  supportPhone?: PhoneDto;
}

export interface ParcelAddressDto {
  street?: string;
  city: string;
  cityTerritoryId: string;
  district: string;
  districtTerritoryId: string;
  cityTerritoryCode: number;
  postalCode?: string;
  country: string;
  coordinates?: { lat: number; lng: number };
  hubId?: string;
  hubName?: string;
}

export interface StateDto {
  id: string;
  name?: string;
  description?: string;
  isBlocking?: boolean;
  isLocked?: boolean;
  visibleFor?: string;
  editableBy?: string;
  color: string;
}

export interface SituationDto {
  id: string;
  name: string;
  description?: string;
  slug: string;
  metadata?: Record<string, unknown>;
}

export interface WeightDto {
  weight?: number;
  dimensionalWeight?: number;
  effectiveWeight: number;
}
