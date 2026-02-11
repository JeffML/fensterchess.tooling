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

  console.log(`  Parsing games with workers...`);

  // Use indexPgnGames with workers for fast parallel processing
  const cursor = indexPgnGames(pgnContent, {
    workers: 4,
    workerBatchSize: 100,
  });

  let processed = 0;
  const progressInterval = 100;

  try {
    for await (const game of cursor) {
      stats.total++;
      processed++;

      if (processed % progressInterval === 0) {
        process.stdout.write(`\r  Processing: ${processed} games...`);
      }

      try {
        const headers = game.headers;

        if (!headers) {
          stats.rejected++;
          continue;
        }

        // Apply filtering (pgnmentor: no title requirement)
        if (!shouldImportGame(game, { requireTitles: false })) {
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
        const pgnChunk = pgnContent.slice(game.startOffset, game.endOffset);

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
  } finally {
    process.stdout.write(`\r  Processing: ${stats.total} games complete!\n`);
  }

  return { games, nextIndex: gameIndex, stats };
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

  console.log("\n✅ Discovery complete - no downloads performed yet\n");
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  discoverPgnmentorFiles()
    .then(() => {
      console.log("✅ File discovery complete!");
      console.log("\nNext step: Implement download logic for new/modified files");
    })
    .catch((error) => {
      console.error("❌ Failed:", error);
      process.exit(1);
    });
}

export { discoverPgnmentorFiles };
