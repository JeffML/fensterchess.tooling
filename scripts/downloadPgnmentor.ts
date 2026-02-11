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

interface PgnmentorSourceTracking {
  lastPageVisit?: string;
  files: Record<string, FileMetadata>;
}

interface ProcessedGames {
  games: GameMetadata[];
  deduplicationIndex: DeduplicationIndex;
  sourceTracking: PgnmentorSourceTracking;
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
 * Check HEAD metadata for multiple files using HTTP Multipart Batch request
 * Returns map of filename -> { lastModified, etag }
 */
async function batchCheckFileMetadata(
  filenames: string[],
): Promise<Map<string, { lastModified?: string; etag?: string }>> {
  console.log(
    `🔍 Checking metadata for ${filenames.length} files (batch HEAD request)...`,
  );

  // TODO: Implement HTTP Multipart Batched Request Format
  // For now, return empty map (will be implemented in next iteration)
  console.log(`  ⚠️  Batch HEAD not yet implemented - will download all files`);

  return new Map();
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
      const pgnChunk = pgnContent.slice(gameMetadata.startOffset, gameMetadata.endOffset);
      
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
      const chunkPath = path.join(
        indexesDir,
        `chunk-${currentChunk.id}.json`,
      );
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
  const sourceTrackingPath = path.join(DOWNLOAD_DIR, "pgnmentor-tracking.json");
  let sourceTracking: PgnmentorSourceTracking = { files: {} };

  if (fs.existsSync(sourceTrackingPath)) {
    console.log("📂 Loading existing source tracking...");
    sourceTracking = JSON.parse(fs.readFileSync(sourceTrackingPath, "utf-8"));
    console.log(
      `  ✅ Last page visit: ${sourceTracking.lastPageVisit || "never"}\n`,
    );
  }

  const visitDate = new Date().toISOString();

  // Step 1: Discover available files
  const discoveredFiles = await discoverPlayerFiles();

  // Step 2: Batch check HEAD metadata
  const fileMetadataMap = await batchCheckFileMetadata(discoveredFiles);

  // Step 3: Classify files as new/modified/unchanged
  const newFiles: string[] = [];
  const modifiedFiles: Array<{ filename: string; oldDate?: string; newDate?: string }> = [];
  const unchangedFiles: string[] = [];

  for (const filename of discoveredFiles) {
    const existing = sourceTracking.files[filename];
    
    if (!existing) {
      console.log(`  📥 New file: ${filename}`);
      newFiles.push(filename);
      continue;
    }

    // Check if file was updated (if we have metadata from batch HEAD)
    const metadata = fileMetadataMap.get(filename);
    if (metadata?.lastModified && existing.lastModified) {
      if (metadata.lastModified !== existing.lastModified) {
        console.log(`  🔄 Modified: ${filename}`);
        console.log(`     Previous: ${existing.lastModified}`);
        console.log(`     Current:  ${metadata.lastModified}`);
        modifiedFiles.push({
          filename,
          oldDate: existing.lastModified,
          newDate: metadata.lastModified,
        });
        continue;
      }
    }

    // Already have this file and it hasn't changed
    unchangedFiles.push(filename);
  }

  // Summary report
  console.log("\n" + "=".repeat(60));
  console.log("📊 Discovery Summary");
  console.log("=".repeat(60));
  console.log(`Total files discovered: ${discoveredFiles.length}`);
  console.log(`  ✨ New: ${newFiles.length}`);
  console.log(`  🔄 Modified: ${modifiedFiles.length}`);
  console.log(`  ✅ Unchanged: ${unchangedFiles.length}`);
  console.log("=".repeat(60));

  if (newFiles.length > 0) {
    console.log("\n📥 New files:");
    newFiles.forEach(f => console.log(`   - ${f}`));
  }

  if (modifiedFiles.length > 0) {
    console.log("\n🔄 Modified files:");
    modifiedFiles.forEach(({ filename, oldDate, newDate }) => {
      console.log(`   - ${filename}`);
      console.log(`     ${oldDate} → ${newDate}`);
    });
  }

  const filesToProcess = [...newFiles, ...modifiedFiles.map(f => f.filename)];

  if (filesToProcess.length === 0) {
    console.log("\n✅ All files up to date - nothing to download\n");
    return;
  }

  console.log(`\n🚀 Starting download and processing of ${filesToProcess.length} files...\n`);

  // Load existing chunks and deduplication index
  const indexesDir = path.join(DOWNLOAD_DIR, "..", "indexes");
  const { maxGameId, deduplicationIndex, lastChunk } = loadExistingChunksData(indexesDir);
  
  console.log(`📊 Current database state:`);
  console.log(`  Max game ID: ${maxGameId}`);
  console.log(`  Unique games: ${Object.keys(deduplicationIndex).length}`);
  console.log(`  Last chunk: ${lastChunk ? `chunk-${lastChunk.id} (${lastChunk.games.length} games)` : 'none'}\n`);

  let nextGameId = maxGameId + 1;
  const totalStats = { total: 0, accepted: 0, rejected: 0, duplicates: 0 };
  const allNewGames: GameMetadata[] = [];

  // Process each file
  for (let i = 0; i < filesToProcess.length; i++) {
    const filename = filesToProcess[i];
    const fileNum = i + 1;

    console.log(`\n[${ fileNum}/${filesToProcess.length}] Processing ${filename}...`);

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
        nextGameId
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
      console.log(`     Total: ${stats.total}, Accepted: ${stats.accepted}, Rejected: ${stats.rejected}, Duplicates: ${stats.duplicates}`);

      // Periodic saves and prompts
      if ((fileNum % 5 === 0) || (fileNum === filesToProcess.length)) {
        console.log(`\n💾 Saving progress after ${fileNum} files...`);
        saveGamesToChunks(allNewGames, indexesDir, lastChunk);
        allNewGames.length = 0; // Clear saved games

        // Update source tracking
        sourceTracking.lastPageVisit = visitDate;
        fs.writeFileSync(sourceTrackingPath, JSON.stringify(sourceTracking, null, 2));
        console.log(`  ✅ Source tracking updated`);
      }

      // Throttle
      if (i < filesToProcess.length - 1) {
        console.log(`  ⏳ Throttling ${THROTTLE_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, THROTTLE_MS));
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

  // Final source tracking update
  sourceTracking.lastPageVisit = visitDate;
  fs.writeFileSync(sourceTrackingPath, JSON.stringify(sourceTracking, null, 2));

  // Final summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 Processing Complete");
  console.log("=".repeat(60));
  console.log(`Files processed: ${filesToProcess.length}`);
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
