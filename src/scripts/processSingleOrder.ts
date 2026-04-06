import "../utils/env";
import { fetchOrderByPageId } from "../clients/notion";
import { processOrder } from "../services/shipmentService";
import { logger } from "../utils/logger";

async function main() {
  const pageId = process.argv[2];
  if (!pageId) { console.error("\n❌ Usage: npm run single -- <notion-page-id>\n"); process.exit(1); }

  logger.info("Processing single order", { notionPageId: pageId });
  console.log("\n📦 Processing page: " + pageId + "\n");

  const order = await fetchOrderByPageId(pageId);
  if (!order) { console.error("\n❌ Could not fetch page: " + pageId + "\n"); process.exit(1); }

  console.log("   Order:    " + (order.رقم_الطلب ?? "(no order number)"));
  console.log("   Customer: " + (order.اسم_صاحب_الطلبية ?? "(no name)") + "\n");

  const result = await processOrder(order);

  if (result.status === "success") {
    console.log("\n✅ Success!");
    console.log("   Parcel ID: " + result.zrParcelId);
    console.log("   Tracking:  " + result.trackingNumber);
    console.log("   Label:     " + result.localLabelPath);
    console.log("   URL:       " + result.labelUrl + "\n");
  } else if (result.status === "skipped") {
    console.log("\n⏭️  Skipped: " + result.reason + "\n");
  } else {
    console.log("\n❌ Failed [" + result.phase + "]: " + result.error + "\n");
    process.exit(1);
  }
}

main().catch((err) => { logger.error("Crashed", { err }); process.exit(1); });
