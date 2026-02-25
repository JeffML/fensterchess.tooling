// Upload generated indexes to Netlify Blobs
// Run with: node --env-file=.env scripts/uploadToBlobs.js

import fs from "fs";
import path from "path";
import readline from "readline";
import { getStore } from "@netlify/blobs";

const INDEXES_DIR = "./data/indexes";

/**
 * Prompt user for confirmation
 */
function promptConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

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

  // Fetch existing blobs to compare
  console.log("🔍 Checking existing blobs in store...\n");
  const { blobs } = await store.list({ prefix: "indexes/" });
  const existingBlobsMap = new Map();

  // Download existing blob metadata (we'll compare content for modified detection)
  for (const blob of blobs) {
    existingBlobsMap.set(blob.key, blob);
  }

  // Categorize files: new, modified, unchanged
  const newFiles = [];
  const modifiedFiles = [];
  const unchangedFiles = [];
  let totalLocalSize = 0;
  let totalRemoteSize = 0;

  for (const filename of files) {
    const filepath = path.join(INDEXES_DIR, filename);
    const stats = fs.statSync(filepath);
    const localSize = stats.size;
    const blobKey = `indexes/${filename}`;

    totalLocalSize += localSize;

    if (!existingBlobsMap.has(blobKey)) {
      // New file
      newFiles.push({ filename, size: localSize, key: blobKey });
    } else {
      // File exists - compare content to detect modifications
      const localContent = fs.readFileSync(filepath, "utf-8");
      const remoteContent = await store.get(blobKey, { type: "text" });
      const remoteSize = remoteContent
        ? Buffer.byteLength(remoteContent, "utf-8")
        : 0;

      totalRemoteSize += remoteSize;

      if (localContent !== remoteContent) {
        // Content differs - modified
        modifiedFiles.push({
          filename,
          localSize,
          remoteSize,
          key: blobKey,
          sizeDiff: localSize - remoteSize,
        });
      } else {
        // Same content - unchanged
        unchangedFiles.push({ filename, size: localSize, key: blobKey });
      }
    }
  }

  // Calculate size for new files
  totalRemoteSize += newFiles.reduce(
    (sum, f) => sum + (existingBlobsMap.get(f.key)?.size || 0),
    0,
  );

  // Calculate game totals for summary (from master-index.json)
  let localTotalGames = null;
  let remoteTotalGames = null;

  try {
    const localMasterIndexPath = path.join(INDEXES_DIR, "master-index.json");
    if (fs.existsSync(localMasterIndexPath)) {
      const localMasterIndex = JSON.parse(
        fs.readFileSync(localMasterIndexPath, "utf-8"),
      );
      if (typeof localMasterIndex.totalGames === "number") {
        localTotalGames = localMasterIndex.totalGames;
      }
    }
  } catch (error) {
    // Non-fatal: game totals are optional summary information
  }

  try {
    const remoteMasterIndexContent = await store.get(
      "indexes/master-index.json",
      {
        type: "text",
      },
    );
    if (remoteMasterIndexContent) {
      const remoteMasterIndex = JSON.parse(remoteMasterIndexContent);
      if (typeof remoteMasterIndex.totalGames === "number") {
        remoteTotalGames = remoteMasterIndex.totalGames;
      }
    }
  } catch (error) {
    // Non-fatal: remote may not have a master index yet
  }

  // Show diff summary
  console.log("=".repeat(60));
  console.log("📊 Upload Summary");
  console.log("=".repeat(60));

  if (newFiles.length > 0) {
    console.log(`\n🆕 New files (${newFiles.length}):`);
    newFiles.forEach((f) => {
      const sizeMB = (f.size / 1024 / 1024).toFixed(2);
      console.log(`   + ${f.filename} (${sizeMB} MB)`);
    });
  }

  if (modifiedFiles.length > 0) {
    console.log(`\n✏️  Modified files (${modifiedFiles.length}):`);
    modifiedFiles.forEach((f) => {
      const localMB = (f.localSize / 1024 / 1024).toFixed(2);
      const remoteMB = (f.remoteSize / 1024 / 1024).toFixed(2);
      const diffSign = f.sizeDiff >= 0 ? "+" : "";
      const diffMB = (Math.abs(f.sizeDiff) / 1024 / 1024).toFixed(2);
      console.log(
        `   ~ ${f.filename} (${localMB} MB, was ${remoteMB} MB, ${diffSign}${diffMB} MB)`,
      );
    });
  }

  if (unchangedFiles.length > 0) {
    console.log(`\n✓ Unchanged files (${unchangedFiles.length}):`);
    unchangedFiles.forEach((f) => {
      const sizeMB = (f.size / 1024 / 1024).toFixed(2);
      console.log(`   = ${f.filename} (${sizeMB} MB)`);
    });
  }

  console.log("\n" + "-".repeat(60));
  console.log(`Total files:       ${files.length}`);
  console.log(
    `Local size:        ${(totalLocalSize / 1024 / 1024).toFixed(2)} MB`,
  );
  console.log(
    `Changes:           ${newFiles.length} new, ${modifiedFiles.length} modified, ${unchangedFiles.length} unchanged`,
  );
  if (localTotalGames !== null) {
    console.log(
      `Total games:       ${localTotalGames.toLocaleString()} (local)`,
    );
  }
  if (localTotalGames !== null && remoteTotalGames !== null) {
    const newGames = localTotalGames - remoteTotalGames;
    const sign = newGames >= 0 ? "+" : "";
    console.log(
      `New games:         ${sign}${newGames.toLocaleString()} vs production`,
    );
  }
  console.log("=".repeat(60));

  // If nothing to upload, exit
  if (newFiles.length === 0 && modifiedFiles.length === 0) {
    console.log("\n✓ All files are up to date. Nothing to upload.");
    return;
  }

  // Prompt for confirmation
  console.log();
  const confirmed = await promptConfirmation("Continue with upload? [y/N]: ");

  if (!confirmed) {
    console.log("\n❌ Upload cancelled by user.");
    process.exit(0);
  }

  // Upload files
  console.log("\n📤 Uploading files...\n");
  let totalSize = 0;
  const uploads = [];

  const filesToUpload = [...newFiles, ...modifiedFiles];

  for (const fileInfo of filesToUpload) {
    const filepath = path.join(INDEXES_DIR, fileInfo.filename);
    const stats = fs.statSync(filepath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    totalSize += stats.size;

    console.log(`📁 ${fileInfo.filename} (${sizeMB} MB)`);

    try {
      const content = fs.readFileSync(filepath, "utf-8");
      await store.set(fileInfo.key, content);
      uploads.push({
        filename: fileInfo.filename,
        size: stats.size,
        key: fileInfo.key,
      });
      console.log(`   ✅ Uploaded\n`);
    } catch (error) {
      console.error(
        `   ❌ Failed to upload ${fileInfo.filename}:`,
        error.message,
      );
      process.exit(1);
    }
  }

  // Update source-tracking.json to reflect production state
  console.log("\n📝 Updating production source tracking...");

  try {
    // Find which chunks were uploaded
    const uploadedChunkFiles = uploads
      .filter((u) => u.filename.startsWith("chunk-"))
      .map((u) => u.filename);

    if (uploadedChunkFiles.length > 0) {
      console.log(`  Found ${uploadedChunkFiles.length} chunk files uploaded`);

      // Read all uploaded chunks to extract source file metadata
      const sourceFileMap = new Map();

      for (const chunkFilename of uploadedChunkFiles) {
        const chunkPath = path.join(INDEXES_DIR, chunkFilename);
        const chunkData = JSON.parse(fs.readFileSync(chunkPath, "utf-8"));

        for (const game of chunkData.games) {
          if (game.source === "pgnmentor" && game.sourceFile) {
            if (!sourceFileMap.has(game.sourceFile)) {
              sourceFileMap.set(game.sourceFile, {
                filename: game.sourceFile,
                url: `https://www.pgnmentor.com/players/${game.sourceFile}`,
                gameCount: 0,
                uploadDate: new Date().toISOString(),
              });
            }
            sourceFileMap.get(game.sourceFile).gameCount++;
          }
        }
      }

      // Update source-tracking.json
      const sourceTrackingPath = path.join(INDEXES_DIR, "source-tracking.json");
      let allSourceTracking = {};

      if (fs.existsSync(sourceTrackingPath)) {
        allSourceTracking = JSON.parse(
          fs.readFileSync(sourceTrackingPath, "utf-8"),
        );
      }

      if (!allSourceTracking.pgnmentor) {
        allSourceTracking.pgnmentor = { files: {} };
      }

      // Merge uploaded file metadata into tracking
      for (const [filename, metadata] of sourceFileMap) {
        allSourceTracking.pgnmentor.files[filename] = {
          ...allSourceTracking.pgnmentor.files[filename], // Keep existing metadata like lastModified
          ...metadata, // Update with upload metadata
        };
      }

      allSourceTracking.pgnmentor.lastPageVisit = new Date().toISOString();

      fs.writeFileSync(
        sourceTrackingPath,
        JSON.stringify(allSourceTracking, null, 2),
      );

      console.log(
        `  ✅ Updated tracking for ${sourceFileMap.size} source files`,
      );
    } else {
      console.log("  ℹ️  No chunk files uploaded - tracking unchanged");
    }
  } catch (error) {
    console.warn(`  ⚠️  Failed to update source tracking: ${error.message}`);
    console.warn("     Continuing anyway - tracking can be manually updated");
  }

  // Final Summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 Upload Complete");
  console.log("=".repeat(60));
  console.log(`Files uploaded:  ${uploads.length}`);
  console.log(`Total size:      ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Blob store:      master-games`);
  console.log(`Site ID:         ${process.env.SITE_ID.substring(0, 8)}...`);
  console.log("=".repeat(60));
  console.log("\n✓ Master game indexes are now available in Netlify Blobs.");
  console.log("✓ Production source tracking updated.");

  // Explicit exit to ensure process terminates cleanly
  process.exit(0);
}

uploadToBlobs().catch((error) => {
  console.error("\n❌ Upload failed:", error.message);
  process.exit(1);
});
