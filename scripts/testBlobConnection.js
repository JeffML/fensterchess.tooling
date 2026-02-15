// Test Netlify Blobs connection from tooling repo
// Run with: node --env-file=.env scripts/testBlobConnection.js
import { getStore } from "@netlify/blobs";

async function testBlobConnection() {
  console.log("🧪 Testing Netlify Blobs connection from tooling...\n");

  console.log("Environment variables:");
  console.log(
    "  NETLIFY_AUTH_TOKEN:",
    process.env.NETLIFY_AUTH_TOKEN ? "✓ Set" : "✗ Missing",
  );
  console.log("  SITE_ID:", process.env.SITE_ID ? "✓ Set" : "✗ Missing");
  console.log();

  // Try simple getStore with just name (like fensterchess functions do when deployed)
  console.log("Method 1: getStore('master-games') - simple name only");
  try {
    const store = getStore("master-games");

    console.log("  Store created. Listing blobs...");
    const { blobs } = await store.list({ prefix: "indexes/", limit: 3 });

    console.log(`  ✅ Success! Found ${blobs.length} blobs (showing first 3):`);
    blobs.forEach((blob) => {
      console.log(`     - ${blob.key}`);
    });
    console.log();
  } catch (error) {
    console.error("  ❌ Failed:", error.message);
    console.log();
  }

  // If SITE_ID exists, try explicit credentials
  if (process.env.SITE_ID && process.env.NETLIFY_AUTH_TOKEN) {
    console.log(
      "Method 2: getStore({ name, siteID, token }) - explicit credentials",
    );
    try {
      const store = getStore({
        name: "master-games",
        siteID: process.env.SITE_ID,
        token: process.env.NETLIFY_AUTH_TOKEN,
      });

      console.log("  Store created. Listing blobs...");
      const { blobs } = await store.list({ prefix: "indexes/", limit: 3 });

      console.log(
        `  ✅ Success! Found ${blobs.length} blobs (showing first 3):`,
      );
      blobs.forEach((blob) => {
        console.log(`     - ${blob.key}`);
      });
    } catch (error) {
      console.error("  ❌ Failed:", error.message);
    }
  } else {
    console.log("\nMethod 2: Skipped (SITE_ID not set)");
  }
}

testBlobConnection().catch((error) => {
  console.error("\n❌ Test failed:", error.message);
  process.exit(1);
});
