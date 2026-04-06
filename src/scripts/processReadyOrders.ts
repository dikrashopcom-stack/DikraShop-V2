import "../utils/env";
import { fetchReadyOrders } from "../clients/notion";
import { processBatch, printBatchSummary } from "../services/shipmentService";
import { logger } from "../utils/logger";

async function main() {
  logger.info("🚀 processReadyOrders starting");
  const orders = await fetchReadyOrders();
  if (orders.length === 0) { console.log("\n✅ No orders ready to ship.\n"); return; }
  console.log("\n📦 Found " + orders.length + " order(s) to process...\n");
  const results = await processBatch(orders);
  printBatchSummary(results);
}

main().catch((err) => { logger.error("Crashed", { err }); process.exit(1); });
