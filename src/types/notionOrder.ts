export type ShipmentStatus = "⏳ Processing" | "✅ Shipped" | "❌ Failed" | "🔄 Retrying";
export type DeliveryType  = "المنزل 🏠" | "المكتب 💼";
export type PaymentStatus = "الدفع عند الإستلام" | "تم الدفع عن طريق BaridiMob" | "تم الدفع عن طريق CCP";

// Raw data as read from Notion — all fields optional since rows can be sparse
export interface NotionOrderRaw {
  notionPageId: string;
  رقم_الطلب: string | null;
  اسم_صاحب_الطلبية: string | null;
  الهاتف: string | null;
  الولاية: string | null;
  البلدية: string | null;
  نوع_التوصيل: DeliveryType | null;
  المبلغ_الإجمالي: number | null;
  الكمية: number | null;
  ملاحظات_الطلب: string | null;
  حالة_الدفع: PaymentStatus | null;
  مصاريف_التوصيل: number | null;
  سعر_اللوحة: number | null;
  الإسم_في_اللوحة: string | null;
  العبارة_في_اللوحة: string | null;
  لون_الخلفية: string | null;
  لون_الإطار: string | null;
  لون_الفويل: string | null;
  // Moon design fields — add matching properties to your Notion database
  // TODO: rename these keys if your Notion property names differ
  تاريخ_الحدث: string | null;   // date property: "تاريخ الحدث" (event / birth date)
  الخط: string | null;           // select property: "الخط" (font choice, optional)
  Generated_Design_Path: string | null; // rich_text property: "Generated Design Path" (auto-filled)
  جاهز_للشحن: boolean;
  ZR_Parcel_ID: string | null;
  رقم_التتبع: string | null;
  Label_URL: string | null;
  حالة_الشحن: ShipmentStatus | null;
  ZR_Error: string | null;
  Last_Sync_At: string | null;
}

// Validated and enriched order ready for ZR API call
export interface ValidatedOrder {
  notionPageId: string;
  orderNumber: string;      // رقم الطلب → ZR externalId
  customerName: string;
  phone: string;            // normalized: +213XXXXXXXXX
  wilaya: string;
  commune: string;
  communeId: string;        // UUID: ZR districtTerritoryId
  wilayaId: string;         // UUID: ZR cityTerritoryId (= commune.parentId)
  deliveryType: "home" | "pickup-point";
  totalAmount: number;      // المبلغ الإجمالي — full order value (declared)
  codAmount: number;        // amount ZR collects on delivery; 0 if prepaid
  quantity: number;
  unitPrice: number;        // سعر اللوحة or المبلغ الإجمالي
  productDescription: string; // 2–250 chars, no | characters
  isCOD: boolean;
  hubId: string | null;       // ZR hub UUID for pickup-point parcels; null for home delivery
}
