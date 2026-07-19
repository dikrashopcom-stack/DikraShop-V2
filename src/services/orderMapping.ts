import { v4 as uuidv4 } from "uuid";
import { ValidatedOrder } from "../types/notionOrder";
import { ZRCreateParcelRequest } from "../types/zr";

export function mapOrderToZRPayload(order: ValidatedOrder): ZRCreateParcelRequest {
  // ZR `amount` is what the courier COLLECTS on delivery. For prepaid orders
  // (BaridiMob/CCP) codAmount is 0, so ZR must NOT collect cash again — sending
  // totalAmount here would double-charge an already-paid customer.
  const amount = order.codAmount;

  // Keep the line-item value consistent with the collected amount: per-unit price
  // derived from the collected amount so unitPrice × quantity === amount.
  const qty = order.quantity > 0 ? order.quantity : 1;
  const unitPrice = Math.round((amount / qty) * 100) / 100;

  return {
    customer: {
      customerId: uuidv4(),
      name: order.customerName,
      phone: { number1: order.phone },
    },
    deliveryAddress: {
      cityTerritoryId:     order.wilayaId,
      districtTerritoryId: order.communeId,
    },
    orderedProducts: [{
      productName: "Cadre Cadeau",
      unitPrice,
      quantity:    qty,
      stockType:   "none",
      weight:      0.5,
    }],
    deliveryType: order.deliveryType,
    ...(order.hubId ? { hubId: order.hubId } : {}),
    description:  order.productDescription, // "Cadre Cadeau pour: <name>"
    amount,
    externalId: order.orderNumber,
  };
}
