import "../utils/env";
import { generateMoonDesign } from "../services/moonDesignService";
import { logger } from "../utils/logger";

async function main() {
  const pageId = process.argv[2];

  if (!pageId) {
    console.error("\n❌ Usage: npm run moon -- <notion-page-id>\n");
    console.error("   Example: npm run moon -- 1a2b3c4d-5678-...\n");
    process.exit(1);
  }

  console.log(`\n🌙 Generating moon design for page: ${pageId}\n`);
  logger.info("Moon design script started", { pageId });

  const result = await generateMoonDesign(pageId);

  if (result.status === "success") {
    console.log("✅ Success!");
    console.log(`   Moon phase : ${result.moonPhase}`);
    console.log(`   Output     : ${result.outputPath}\n`);
  } else {
    console.error(`\n❌ Failed: ${result.error}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error("Unhandled crash in moon design script", { err });
  console.error("\n💥 Unhandled error:", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
