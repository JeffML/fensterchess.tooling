// Download all master game indexes from Netlify Blobs to timestamped backup folder
// Run with: npm run backup
// Requires: NETLIFY_AUTH_TOKEN and SITE_ID in .env

import fs from "fs";
import path from "path";
import { getStore } from "@netlify/blobs";

async function backupFromBlobs() {
  console.log("📥 Backing up master game indexes from Netlify Blobs...\n");

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

  // Create timestamped backup directory
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
  const backupDir = path.join("backups", timestamp);

  console.log(`📁 Backup directory: ${backupDir}\n`);

  // List all blobs with "indexes/" prefix
  console.log("🔍 Listing blobs from store...");
  const { blobs } = await store.list({ prefix: "indexes/" });

  if (blobs.length === 0) {
    console.error("❌ No blobs found in store with 'indexes/' prefix");
    console.error("   Store may be empty or prefix is incorrect.");
    process.exit(1);
  }

  console.log(`Found ${blobs.length} blobs to download:\n`);

  let totalSize = 0;
  const downloads: Array<{ key: string; size: number; path: string }> = [];

  // Download each blob
  for (const blob of blobs) {
    const filename = path.basename(blob.key);

    console.log(`📄 ${filename}`);

    try {
      // Download blob content
      const content = await store.get(blob.key, { type: "text" });

      if (!content) {
        console.error(`   ⚠️  Blob ${blob.key} returned null - skipping`);
        continue;
      }

      // Write to timestamped backup folder, preserving "indexes/" structure
      const localPath = path.join(backupDir, blob.key);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content, "utf-8");

      // Get actual file size after writing
      const fileSize = fs.statSync(localPath).size;
      totalSize += fileSize;
      const sizeMB = (fileSize / 1024 / 1024).toFixed(2);

      downloads.push({ key: blob.key, size: fileSize, path: localPath });
      console.log(`   ✅ Saved to ${localPath} (${sizeMB} MB)`);
    } catch (error) {
      console.error(
        `   ❌ Failed to download ${blob.key}:`,
        (error as Error).message,
      );
      // Continue with other files rather than exiting
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Backup Summary");
  console.log("=".repeat(60));
  console.log(`Timestamp:       ${timestamp}`);
  console.log(`Files downloaded: ${downloads.length} / ${blobs.length}`);
  console.log(`Total size:      ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Backup location: ${backupDir}`);
  console.log("=".repeat(60));

  if (downloads.length < blobs.length) {
    console.log(
      "\n⚠️  Some files failed to download - check errors above",
    );
    process.exit(1);
  }

  console.log("\n🎉 Backup complete!");
  console.log(
    "   All indexes saved locally. Safe to proceed with data updates.",
  );
}

backupFromBlobs().catch((error) => {
  console.error("\n❌ Backup failed:", error.message);
  console.error(error.stack);
  process.exit(1);
});
