// Download PGN files from pgnmentor.com/players
// Discovers available files and checks for updates using batch HEAD requests

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { shouldImportGame } from "./filterGame.js";
import { hashGame } from "./hashGame.js";
import { indexPgnGames } from "@chess-pgn/chess-pgn";
import type {
  GameMetadata,
  DeduplicationIndex,
  SourceTracking,
  SiteSourceTracking,
} from "./types.js";

const DOWNLOAD_DIR = "./data/pgn-downloads";
const PGNMENTOR_BASE_URL = "https://www.pgnmentor.com";
const FILES_PAGE_URL = `${PGNMENTOR_BASE_URL}/files.html`;
const THROTTLE_MS = 2000; // 2 seconds between downloads
const USER_AGENT =
  "Fenster Chess Opening Explorer (https://fensterchess.com) - Educational research project";

interface FileMetadata {
  filename: string;
  url: string;
  lastModified?: string;
  etag?: string;
  size?: number;
  gameCount?: number;
  downloadDate?: string;
}

interface ProcessedGames {
  games: GameMetadata[];
  deduplicationIndex: DeduplicationIndex;
  sourceTracking: SiteSourceTracking;
  stats: {
    total: number;
    accepted: number;
    rejected: number;
    duplicates: number;
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch the files page and extract all players/*.zip links
 */
async function discoverPlayerFiles(): Promise<string[]> {
  console.log(`📡 Fetching files page: ${FILES_PAGE_URL}`);

  const response = await fetch(FILES_PAGE_URL, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch files page: ${response.status}`);
  }

  const html = await response.text();

  // Extract all href links matching players/*.zip
  const linkRegex = /href=["']players\/([^"']+\.zip)["']/gi;
  const filesSet = new Set<string>();
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    filesSet.add(match[1]);
  }

  const files = Array.from(filesSet).sort();
  console.log(`  ✅ Found ${files.length} player files\n`);
  return files;
}

/**
 * Check HEAD metadata for all files concurrently (like k6 http.batch())
 * Returns map of filename -> { lastModified, etag }
 */
async function batchCheckFileMetadata(
  filenames: string[],
): Promise<Map<string, { lastModified?: string; etag?: string }>> {
  console.log(
    `🔍 Checking metadata for ${filenames.length} files concurrently...`,
  );

  const results = new Map<string, { lastModified?: string; etag?: string }>();

  // Make all HEAD requests concurrently (k6 batch pattern)
  const promises = filenames.map(async (filename) => {
    const url = `${PGNMENTOR_BASE_URL}/players/${filename}`;

    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
      });

      if (response.ok) {
        const lastModified = response.headers.get("last-modified") || undefined;
        const etag = response.headers.get("etag") || undefined;

        return {
          filename,
          metadata: { lastModified, etag },
          success: true,
        };
      } else {
        return {
          filename,
          metadata: {},
          success: false,
          status: response.status,
        };
      }
    } catch (error) {
      return {
        filename,
        metadata: {},
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // Wait for all requests to complete
  console.log(
    `  ⏳ Waiting for ${filenames.length} concurrent HEAD requests...`,
  );
  const allResults = await Promise.all(promises);

  // Collect results and show summary
  let successCount = 0;
  let errorCount = 0;

  for (const result of allResults) {
    if (result.success) {
      results.set(result.filename, result.metadata);
      successCount++;
    } else {
      errorCount++;
    }
  }

  console.log(
    `  ✅ Metadata check complete: ${successCount} success, ${errorCount} errors\n`,
  );
  return results;
}

async function downloadFile(url: string, outputPath: string): Promise<boolean> {
  try {
    console.log(`  Downloading: ${url}`);

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      console.error(`  ❌ HTTP ${response.status}: ${response.statusText}`);
      return false;
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(outputPath, Buffer.from(buffer));

    console.log(
      `  ✅ Downloaded: ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`,
    );
    return true;
  } catch (error) {
    console.error(`  ❌ Download failed:`, error);
    return false;
  }
}

function extractZip(zipPath: string): string | null {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    // Find PGN file
    const pgnEntry = entries.find((entry) => entry.entryName.endsWith(".pgn"));

    if (!pgnEntry) {
      console.error("  ❌ No PGN file found in ZIP");
      return null;
    }

    console.log(`  📦 Extracting: ${pgnEntry.entryName}`);
    return zip.readAsText(pgnEntry);
  } catch (error) {
    console.error(`  ❌ Extraction failed:`, error);
    return null;
  }
}

async function processGames(
  pgnContent: string,
  sourceFile: string,
  deduplicationIndex: DeduplicationIndex,
  gameIndex: number,
): Promise<{
  games: GameMetadata[];
  nextIndex: number;
  stats: {
    total: number;
    accepted: number;
    rejected: number;
    duplicates: number;
  };
}> {
  const games: GameMetadata[] = [];
  const stats = {
    total: 0,
    accepted: 0,
    rejected: 0,
    duplicates: 0,
  };

  console.log(`  Parsing games...`);

  // Index game boundaries (fast, no full parsing)
  const indices = indexPgnGames(pgnContent);

  let processed = 0;
  const progressInterval = 100;

  for (const gameMetadata of indices) {
    stats.total++;
    processed++;

    if (processed % progressInterval === 0) {
      process.stdout.write(`\r  Processing: ${processed} games...`);
    }

    try {
      const headers = gameMetadata.headers;

      if (!headers) {
        stats.rejected++;
        continue;
      }

      // Apply filtering (pgnmentor: no title requirement)
      // Note: shouldImportGame() handles metadata objects with .headers property
      if (!shouldImportGame(gameMetadata, { requireTitles: false })) {
        stats.rejected++;
        continue;
      }

      // Check for duplicates (hash based on headers only, no moves needed)
      const hash = hashGame(headers);
      if (deduplicationIndex[hash] !== undefined) {
        stats.duplicates++;
        continue;
      }

      // Game is accepted - extract just the moves section (not headers)
      const pgnChunk = pgnContent.slice(
        gameMetadata.startOffset,
        gameMetadata.endOffset,
      );

      // Strip headers - find where moves start (after last header line and blank line)
      const movesSectionMatch = pgnChunk.match(/\n\n(.+)/s);
      const movesOnly = movesSectionMatch
        ? movesSectionMatch[1].trim()
        : pgnChunk;

      const metadata: GameMetadata = {
        idx: gameIndex,
        white: headers.White || "Unknown",
        black: headers.Black || "Unknown",
        whiteElo: parseInt(headers.WhiteElo || "0"),
        blackElo: parseInt(headers.BlackElo || "0"),
        result: headers.Result || "*",
        date: headers.Date || "????.??.??",
        event: headers.Event || "Unknown",
        site: headers.Site || "?",
        eco: headers.ECO,
        opening: headers.Opening,
        variation: headers.Variation,
        subVariation: headers.SubVariation,
        moves: movesOnly, // Store only moves section (no headers)
        ply: 0, // Will be calculated in buildIndexes
        source: "pgnmentor",
        sourceFile,
        hash,
      };

      games.push(metadata);
      deduplicationIndex[hash] = gameIndex;
      gameIndex++;
      stats.accepted++;
    } catch (error) {
      // Error processing this game
      stats.rejected++;
    }
  }

  process.stdout.write(`\r  Processing: ${stats.total} games complete!\n`);

  return { games, nextIndex: gameIndex, stats };
}

/**
 * Load existing chunks and find max game ID + deduplication index
 */
function loadExistingChunksData(indexesDir: string): {
  maxGameId: number;
  deduplicationIndex: DeduplicationIndex;
  lastChunk: { id: number; games: GameMetadata[] } | null;
} {
  if (!fs.existsSync(indexesDir)) {
    return { maxGameId: -1, deduplicationIndex: {}, lastChunk: null };
  }

  // Find all existing chunks
  const chunkFiles = fs
    .readdirSync(indexesDir)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".json"))
    .sort((a, b) => {
      const numA = parseInt(a.match(/chunk-(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/chunk-(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  if (chunkFiles.length === 0) {
    return { maxGameId: -1, deduplicationIndex: {}, lastChunk: null };
  }

  // Load last chunk
  const lastChunkFile = chunkFiles[chunkFiles.length - 1];
  const lastChunkId = parseInt(lastChunkFile.match(/chunk-(\d+)/)?.[1] || "0");
  const lastChunkPath = path.join(indexesDir, lastChunkFile);
  const lastChunkData: { games: GameMetadata[] } = JSON.parse(
    fs.readFileSync(lastChunkPath, "utf-8"),
  );

  // Find max game ID across all games in last chunk
  let maxGameId = -1;
  const deduplicationIndex: DeduplicationIndex = {};

  // Build dedup index from all chunks
  for (const chunkFile of chunkFiles) {
    const chunkPath = path.join(indexesDir, chunkFile);
    const chunk: { games: GameMetadata[] } = JSON.parse(
      fs.readFileSync(chunkPath, "utf-8"),
    );

    for (const game of chunk.games) {
      if (game.idx > maxGameId) {
        maxGameId = game.idx;
      }
      if (game.hash) {
        deduplicationIndex[game.hash] = game.idx;
      }
    }
  }

  return {
    maxGameId,
    deduplicationIndex,
    lastChunk: { id: lastChunkId, games: lastChunkData.games },
  };
}

/**
 * Save games to chunks, respecting 4000 game limit per chunk
 */
function saveGamesToChunks(
  games: GameMetadata[],
  indexesDir: string,
  existingLastChunk: { id: number; games: GameMetadata[] } | null,
): void {
  if (games.length === 0) return;

  // Ensure indexes directory exists
  if (!fs.existsSync(indexesDir)) {
    fs.mkdirSync(indexesDir, { recursive: true });
  }

  const CHUNK_SIZE = 4000;
  let currentChunk = existingLastChunk
    ? { id: existingLastChunk.id, games: [...existingLastChunk.games] }
    : { id: 0, games: [] };

  let gamesAdded = 0;

  for (const game of games) {
    // Check if adding this game would exceed chunk size
    if (currentChunk.games.length >= CHUNK_SIZE) {
      // Save current chunk
      const chunkPath = path.join(indexesDir, `chunk-${currentChunk.id}.json`);
      fs.writeFileSync(
        chunkPath,
        JSON.stringify({ games: currentChunk.games }, null, 2),
      );
      console.log(
        `  💾 Saved chunk-${currentChunk.id}.json (${currentChunk.games.length} games)`,
      );

      // Start new chunk
      currentChunk = { id: currentChunk.id + 1, games: [] };
    }

    currentChunk.games.push(game);
    gamesAdded++;
  }

  // Save final chunk
  if (currentChunk.games.length > 0) {
    const chunkPath = path.join(indexesDir, `chunk-${currentChunk.id}.json`);
    fs.writeFileSync(
      chunkPath,
      JSON.stringify({ games: currentChunk.games }, null, 2),
    );
    console.log(
      `  💾 Saved chunk-${currentChunk.id}.json (${currentChunk.games.length} games)`,
    );
  }

  console.log(`  ✅ Total games added to chunks: ${gamesAdded}`);
}

async function discoverPgnmentorFiles(): Promise<void> {
  console.log("🎯 Discovering files from pgnmentor.com/files.html\n");
  console.log(`User-Agent: ${USER_AGENT}\n`);

  // Create download directory
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  }

  // Load existing source tracking
  const sourceTrackingPath = path.join(DOWNLOAD_DIR, "..", "indexes", "source-tracking.json");
  let allSourceTracking: SourceTracking = {};
  
  if (fs.existsSync(sourceTrackingPath)) {
    allSourceTracking = JSON.parse(fs.readFileSync(sourceTrackingPath, "utf-8"));
  }
  
  // Get pgnmentor-specific tracking
  let sourceTracking: SiteSourceTracking = allSourceTracking.pgnmentor || { files: {} };
  
  console.log("📂 Loading pgnmentor source tracking...");
  console.log(
    `  ✅ Last page visit: ${sourceTracking.lastPageVisit || "never"}\n`,
  );

  const visitDate = new Date().toISOString();
  const lastVisitDate = sourceTracking.lastPageVisit;

  // Step 0: Check if files page has been modified since last visit
  console.log("🔍 Checking if files page has been modified...");
  const pageResponse = await fetch(FILES_PAGE_URL, {
    method: "HEAD",
    headers: { "User-Agent": USER_AGENT },
  });

  const pageLastModified = pageResponse.headers.get("last-modified");
  console.log(`  Page Last-Modified: ${pageLastModified || "unknown"}`);
  
  if (lastVisitDate && pageLastModified) {
    const lastVisitTime = new Date(lastVisitDate).getTime();
    const pageModifiedTime = new Date(pageLastModified).getTime();
    
    if (pageModifiedTime <= lastVisitTime) {
      console.log(`  ✅ Page unchanged since last visit - nothing to do\n`);
      return;
    }
    console.log(`  📝 Page has been updated since last visit - checking files...\n`);
  } else {
    console.log(`  ⚠️  No previous visit date - proceeding with full check...\n`);
  }

  // Step 1: Discover available files
  const discoveredFiles = await discoverPlayerFiles();

  // Step 2: Batch check HEAD metadata (only if page was modified)
  const fileMetadataMap = await batchCheckFileMetadata(discoveredFiles);

  // Step 3: Classify files as new/modified based on Last-Modified vs lastPageVisit
  const filesToProcess: string[] = [];
  const unchangedFiles: string[] = [];

  for (const filename of discoveredFiles) {
    const metadata = fileMetadataMap.get(filename);
    
    // If we have no previous visit or no Last-Modified header, include the file
    if (!lastVisitDate || !metadata?.lastModified) {
      console.log(`  📥 Will process: ${filename} (no date comparison)`);
      filesToProcess.push(filename);
      continue;
    }

    // Compare file's Last-Modified with our last page visit
    const lastVisitTime = new Date(lastVisitDate).getTime();
    const fileModifiedTime = new Date(metadata.lastModified).getTime();

    if (fileModifiedTime > lastVisitTime) {
      console.log(`  📥 Will process: ${filename}`);
      console.log(`     File modified: ${metadata.lastModified}`);
      console.log(`     Last visit:    ${lastVisitDate}`);
      filesToProcess.push(filename);
    } else {
      unchangedFiles.push(filename);
    }
  }

  // Summary report
  console.log("\n" + "=".repeat(60));
  console.log("📊 Discovery Summary");
  console.log("=".repeat(60));
  console.log(`Total files discovered: ${discoveredFiles.length}`);
  console.log(`  📥 To process: ${filesToProcess.length}`);
  console.log(`  ✅ Unchanged: ${unchangedFiles.length}`);
  console.log("=".repeat(60));

  if (filesToProcess.length > 0) {
    console.log("\n📥 Files to process:");
    filesToProcess.forEach((f) => console.log(`   - ${f}`));
  }

  if (filesToProcess.length === 0) {
    console.log("\n✅ All files up to date - nothing to download");
    
    // Update lastPageVisit to record that we checked
    sourceTracking.lastPageVisit = visitDate;
    allSourceTracking.pgnmentor = sourceTracking;
    fs.writeFileSync(sourceTrackingPath, JSON.stringify(allSourceTracking, null, 2));
    console.log(`✅ Updated lastPageVisit to ${visitDate}\n`);
    return;
  }

  // Apply file limit if MAX_FILES env var is set (for testing)
  const MAX_FILES = parseInt(process.env.MAX_FILES || "0");
  const limitedFiles = MAX_FILES > 0 && filesToProcess.length > MAX_FILES
    ? filesToProcess.slice(0, MAX_FILES)
    : filesToProcess;

  if (limitedFiles.length < filesToProcess.length) {
    console.log(`\n⚠️  MAX_FILES limit: Processing only ${limitedFiles.length} of ${filesToProcess.length} files`);
  }

  console.log(
    `\n🚀 Starting download and processing of ${limitedFiles.length} files...\n`,
  );

  // Load existing chunks and deduplication index
  const indexesDir = path.join(DOWNLOAD_DIR, "..", "indexes");
  const { maxGameId, deduplicationIndex, lastChunk } =
    loadExistingChunksData(indexesDir);

  console.log(`📊 Current database state:`);
  console.log(`  Max game ID: ${maxGameId}`);
  console.log(`  Unique games: ${Object.keys(deduplicationIndex).length}`);
  console.log(
    `  Last chunk: ${lastChunk ? `chunk-${lastChunk.id} (${lastChunk.games.length} games)` : "none"}\n`,
  );

  let nextGameId = maxGameId + 1;
  const totalStats = { total: 0, accepted: 0, rejected: 0, duplicates: 0 };
  const allNewGames: GameMetadata[] = [];

  // Process each file
  for (let i = 0; i < limitedFiles.length; i++) {
    const filename = limitedFiles[i];
    const fileNum = i + 1;

    console.log(
      `\n[${fileNum}/${limitedFiles.length}] Processing ${filename}...`,
    );

    try {
      // Download
      const url = `https://www.pgnmentor.com/players/${filename}`;
      const zipPath = path.join(DOWNLOAD_DIR, filename);

      console.log(`  📥 Downloading...`);
      await downloadFile(url, zipPath);

      // Extract
      console.log(`  📦 Extracting...`);
      const pgnContent = extractZip(zipPath);

      if (!pgnContent) {
        console.error(`  ❌ No PGN content found in ${filename}`);
        continue;
      }

      // Process games
      console.log(`  ⚙️  Processing games...`);
      const { games, nextIndex, stats } = await processGames(
        pgnContent,
        filename,
        deduplicationIndex,
        nextGameId,
      );

      // Update stats
      totalStats.total += stats.total;
      totalStats.accepted += stats.accepted;
      totalStats.rejected += stats.rejected;
      totalStats.duplicates += stats.duplicates;

      allNewGames.push(...games);
      nextGameId = nextIndex;

      // Update source tracking for this file
      const metadata = fileMetadataMap.get(filename);
      sourceTracking.files[filename] = {
        filename,
        url,
        downloadDate: new Date().toISOString(),
        lastModified: metadata?.lastModified,
        etag: metadata?.etag,
        gameCount: games.length,
      };

      console.log(`  ✅ Imported ${games.length} new games`);
      console.log(
        `     Total: ${stats.total}, Accepted: ${stats.accepted}, Rejected: ${stats.rejected}, Duplicates: ${stats.duplicates}`,
      );

      // Periodic saves and prompts
      if (fileNum % 5 === 0 || fileNum === limitedFiles.length) {
        console.log(`\n💾 Saving progress after ${fileNum} files...`);
        saveGamesToChunks(allNewGames, indexesDir, lastChunk);
        allNewGames.length = 0; // Clear saved games

        // Update deduplication index
        const dedupPath = path.join(indexesDir, "deduplication-index.json");
        fs.writeFileSync(
          dedupPath,
          JSON.stringify(deduplicationIndex, null, 2),
        );
        console.log(
          `  ✅ Deduplication index updated (${Object.keys(deduplicationIndex).length} unique games)`,
        );

        // Update source tracking
        sourceTracking.lastPageVisit = visitDate;
        allSourceTracking.pgnmentor = sourceTracking;
        fs.writeFileSync(
          sourceTrackingPath,
          JSON.stringify(allSourceTracking, null, 2),
        );
        console.log(`  ✅ Source tracking updated`);
      }

      // Throttle
      if (i < limitedFiles.length - 1) {
        console.log(`  ⏳ Throttling ${THROTTLE_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS));
      }
    } catch (error) {
      console.error(`  ❌ Error processing ${filename}:`, error);
      // Continue with next file
    }
  }

  // Final save (if any remaining games)
  if (allNewGames.length > 0) {
    console.log(`\n💾 Final save...`);
    saveGamesToChunks(allNewGames, indexesDir, lastChunk);
  }

  // Final deduplication index save
  const dedupPath = path.join(indexesDir, "deduplication-index.json");
  fs.writeFileSync(dedupPath, JSON.stringify(deduplicationIndex, null, 2));

  // Final source tracking update
  sourceTracking.lastPageVisit = visitDate;
  allSourceTracking.pgnmentor = sourceTracking;
  fs.writeFileSync(sourceTrackingPath, JSON.stringify(allSourceTracking, null, 2));

  // Final summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Processing Complete");
  console.log("=".repeat(60));
  console.log(`Files processed: ${limitedFiles.length}`);
  console.log(`Total games: ${totalStats.total}`);
  console.log(`Accepted: ${totalStats.accepted}`);
  console.log(`Rejected: ${totalStats.rejected}`);
  console.log(`Duplicates skipped: ${totalStats.duplicates}`);
  console.log(`Next game ID: ${nextGameId}`);
  console.log("=".repeat(60));
  console.log("\n✅ Download and chunking complete!\n");
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  discoverPgnmentorFiles()
    .then(() => {
      console.log("✅ pgnmentor.com download complete!");
      console.log("\nNext step: Discuss index update strategy");
    })
    .catch((error) => {
      console.error("❌ Failed:", error);
      process.exit(1);
    });
}

export { discoverPgnmentorFiles };
