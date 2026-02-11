// Test Netlify Blobs connection from tooling repo
// Run with: node --env-file=.env scripts/testBlobConnection.js
import { getStore } from "@netlify/blobs";

async function testBlobConnection() {
  console.log("🧪 Testing Netlify Blobs connection from tooling...\n");

  // Check environment variables
  if (!process.env.NETLIFY_AUTH_TOKEN) {
    console.error("❌ NETLIFY_AUTH_TOKEN not found in .env");
    process.exit(1);
  }
  if (!process.env.SITE_ID) {
    console.error("❌ SITE_ID not found in .env");
    process.exit(1);
  }

  console.log("✅ Environment variables loaded");
  console.log(`   Site ID: ${process.env.SITE_ID.substring(0, 8)}...`);
  console.log(
    `   Token: ${process.env.NETLIFY_AUTH_TOKEN.substring(0, 10)}...\n`,
  );

  // Connect to fensterchess's blob store
  const store = getStore({
    name: "master-games",
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });

  try {
    // Test write
    const testData = {
      test: "tooling-connection-test",
      timestamp: new Date().toISOString(),
      source: "fensterchess.tooling",
    };

    console.log("📝 Writing test blob...");
    await store.set("tooling-test", JSON.stringify(testData));
    console.log("✅ Write successful\n");

    // Test read
    console.log("📖 Reading test blob...");
    const retrieved = await store.get("tooling-test");
    const parsed = JSON.parse(retrieved);
    console.log("Retrieved:", parsed);
    console.log("✅ Read successful\n");

    // Test list
    console.log("📋 Listing blobs...");
    const { blobs } = await store.list();
    console.log(`Found ${blobs.length} blobs:`);
    blobs.forEach((b) => console.log(`   - ${b.key}`));
    console.log("✅ List successful\n");

    // Cleanup
    console.log("🧹 Cleaning up test blob...");
    await store.delete("tooling-test");
    console.log("✅ Cleanup successful\n");

    console.log("🎉 Blob connection test passed!");
    console.log(
      "   Tooling can upload to fensterchess blob store successfully.",
    );
  } catch (error) {
    console.error("❌ Blob operation failed:", error.message);
    if (error.message.includes("401")) {
      console.error("\n💡 This looks like an authentication error.");
      console.error("   Check that your NETLIFY_AUTH_TOKEN is valid.");
    }
    if (error.message.includes("404")) {
      console.error("\n💡 This looks like a site not found error.");
      console.error("   Check that your SITE_ID is correct.");
    }
    process.exit(1);
  }
}

testBlobConnection();
