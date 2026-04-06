import { v4 as uuidv4 } from "uuid";
import { ValidatedOrder } from "../types/notionOrder";
import { ZRCreateParcelRequest } from "../types/zr";

export function mapOrderToZRPayload(order: ValidatedOrder): ZRCreateParcelRequest {
  const amount = order.totalAmount;

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
      unitPrice:   order.unitPrice,
      quantity:    order.quantity,
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
