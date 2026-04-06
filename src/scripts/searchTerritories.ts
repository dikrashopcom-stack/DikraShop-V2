import "../utils/env";
import { searchTerritories } from "../clients/zr";

async function main() {
  const keyword = process.argv[2] ?? "";
  console.log("\n🔍 Searching ZR territories: \"" + (keyword || "(all)") + "\"\n");
  const res = await searchTerritories({ keyword: keyword || undefined, pageNumber: 1, pageSize: 20 });
  console.log("Raw ZR territories response:");
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => { console.error("Failed:", err); process.exit(1); });
