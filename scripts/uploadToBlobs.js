// Upload generated indexes to Netlify Blobs
// Run with: node --env-file=.env scripts/uploadToBlobs.js

import fs from "fs";
import path from "path";
import { getStore } from "@netlify/blobs";

const INDEXES_DIR = "./data/indexes";

async function uploadToBlobs() {
  console.log("📤 Uploading master game indexes to Netlify Blobs...\n");

  // Check environment variables
  if (!process.env.NETLIFY_AUTH_TOKEN) {
    console.error("❌ NETLIFY_AUTH_TOKEN not found in .env");
    process.exit(1);
  }
  if (!process.env.SITE_ID) {
    console.error("❌ SITE_ID not found in .env");
    process.exit(1);
  }

  // Connect to blob store
  const store = getStore({
    name: "master-games",
    siteID: process.env.SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });

  // Check if indexes directory exists
  if (!fs.existsSync(INDEXES_DIR)) {
    console.error(`❌ Indexes directory not found: ${INDEXES_DIR}`);
    console.error("   Run 'npm run build-indexes' first to generate indexes.");
    process.exit(1);
  }

  // Get all JSON files in indexes directory
  const files = fs.readdirSync(INDEXES_DIR).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.error(`❌ No JSON files found in ${INDEXES_DIR}`);
    console.error("   Run 'npm run build-indexes' first to generate indexes.");
    process.exit(1);
  }

  console.log(`Found ${files.length} index files to upload:\n`);

  let totalSize = 0;
  const uploads = [];

  // Upload each file
  for (const filename of files) {
    const filepath = path.join(INDEXES_DIR, filename);
    const stats = fs.statSync(filepath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    totalSize += stats.size;

    console.log(`📁 ${filename} (${sizeMB} MB)`);

    try {
      const content = fs.readFileSync(filepath, "utf-8");
      const blobKey = `indexes/${filename}`; // Store under indexes/ prefix

      await store.set(blobKey, content);
      uploads.push({ filename, size: stats.size, key: blobKey });
      console.log(`   ✅ Uploaded as ${blobKey}\n`);
    } catch (error) {
      console.error(`   ❌ Failed to upload ${filename}:`, error.message);
      process.exit(1);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Upload Summary");
  console.log("=".repeat(60));
  console.log(`Total files:     ${uploads.length}`);
  console.log(`Total size:      ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Blob store:      master-games`);
  console.log(`Site ID:         ${process.env.SITE_ID.substring(0, 8)}...`);
  console.log("=".repeat(60));

  // List all blobs to verify
  console.log("\n📋 Verifying blobs in store...");
  const { blobs } = await store.list({ prefix: "indexes/" });
  console.log(`Found ${blobs.length} blobs with 'indexes/' prefix:`);
  blobs.forEach((blob) => {
    console.log(`   - ${blob.key}`);
  });

  console.log("\n🎉 Upload complete!");
  console.log("   Master game indexes are now available in Netlify Blobs.");
  console.log(
    "   Next: Update fensterchess serverless functions to read from blobs.",
  );
}

uploadToBlobs().catch((error) => {
  console.error("\n❌ Upload failed:", error.message);
  process.exit(1);
});
