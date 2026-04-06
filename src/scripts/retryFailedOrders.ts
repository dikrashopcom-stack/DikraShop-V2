import "../utils/env";
import { fetchFailedOrders } from "../clients/notion";
import { processBatch, printBatchSummary } from "../services/shipmentService";
import { logger } from "../utils/logger";

async function main() {
  logger.info("🔄 retryFailedOrders starting");
  const orders = await fetchFailedOrders();
  if (orders.length === 0) { console.log("\n✅ No failed orders to retry.\n"); return; }
  console.log("\n🔄 Retrying " + orders.length + " order(s)...\n");
  const results = await processBatch(orders);
  printBatchSummary(results);
}

main().catch((err) => { logger.error("Crashed", { err }); process.exit(1); });
