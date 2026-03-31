// Build search indexes from processed games
// Phase 1 - POC with 5 masters

import fs from "fs";
import path from "path";
import { ChessPGN } from "@chess-pgn/chess-pgn";
import {
  openingBook,
  lookupByMoves,
  getPositionBook,
} from "@chess-openings/eco.json";
import type {
  GameMetadata,
  MasterIndex,
  GameIndexChunk,
  OpeningByFenIndex,
  OpeningByNameIndex,
  OpeningByEcoIndex,
  PlayerIndex,
  PlayerEcoMatrix,
  PlayerEcoEntry,
  EventIndex,
  DateIndex,
  DeduplicationIndex,
  SourceTracking,
} from "./types.js";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);

// Netlify Blobs limit: 5 MB per blob
// ~1 KB per game → 4000 games = ~4 MB (with headroom for metadata)
const CHUNK_SIZE = 4000; // Games per chunk (keeps under 5 MB for Netlify Blobs)
const INPUT_FILE = "./data/pgn-downloads/processed-games.json";
const OUTPUT_DIR = "./data/indexes";

interface ProcessedData {
  games: GameMetadata[];
  deduplicationIndex: DeduplicationIndex;
  sourceTracking: SourceTracking;
}

type FullGameIndexChunk = GameIndexChunk & {
  version: string;
  chunkId: number;
  startIdx: number;
  endIdx: number;
};

function chunkFingerprint(games: GameMetadata[]): string {
  // Stable identity: count + first hash + last hash (hash-sorted order)
  if (games.length === 0) return "empty";
  return `${games.length}|${games[0].hash}|${games[games.length - 1].hash}`;
}

function buildGameChunks(games: GameMetadata[]): {
  chunks: GameIndexChunk[];
  masterIndex: MasterIndex;
} {
  console.log("\n📦 Building game chunks...");

  // Sort by hash for stable, deterministic chunk boundaries.
  // New games always insert at their hash position; earlier chunks are unaffected.
  games.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));

  const totalChunks = Math.ceil(games.length / CHUNK_SIZE);
  const chunks: FullGameIndexChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const startIdx = i * CHUNK_SIZE;
    const endIdx = Math.min(startIdx + CHUNK_SIZE, games.length);
    const chunkGames = games.slice(startIdx, endIdx);

    const chunk: FullGameIndexChunk = {
      version: "1.0",
      chunkId: i,
      startIdx,
      endIdx,
      games: chunkGames,
    };

    chunks.push(chunk);
    console.log(`  Chunk ${i}: ${chunkGames.length} games`);
  }

  const masterIndex: MasterIndex = {
    version: "1.0",
    totalGames: games.length,
    totalChunks,
    chunks: chunks.map((chunk) => ({
      id: chunk.chunkId,
      blobKey: `master-games/chunks/chunk-${chunk.chunkId}.json`,
      startIdx: chunk.startIdx,
      endIdx: chunk.endIdx,
    })),
  };

  console.log(`  ✅ Created ${chunks.length} chunks`);
  return { chunks, masterIndex };
}

async function enrichGamesWithEcoJson(
  games: GameMetadata[],
  openings: any,
  positionBook: any,
): Promise<void> {
  console.log("\n🎯 Enriching games with eco.json opening matches...");

  // Precompute reverse map: Opening object → FEN key (O(N) once, avoids O(N×G) per-game scan)
  const openingToFen = new Map<any, string>();
  for (const [fen, opening] of Object.entries(openings)) {
    openingToFen.set(opening, fen);
  }

  // Reuse a ChessPGN instance but recycle it every N unenriched games.
  // V8 never shrinks array backing buffers, so after thousands of move+undo
  // cycles the internal history buffer balloons and operations slow down.
  // Recreating periodically lets V8 release the bloated allocation.
  const RECYCLE_INTERVAL = 500;
  let chess = new ChessPGN();
  let processedCount = 0;

  let matched = 0;
  let unmatched = 0;
  let skipped = 0;
  const progressInterval = 1000;

  for (let i = 0; i < games.length; i++) {
    const game = games[i];

    if ((i + 1) % progressInterval === 0) {
      process.stdout.write(`\r  Processing: ${i + 1}/${games.length} games...`);
    }

    // OPTIMIZATION: Skip games that are already enriched
    if (game.ecoJsonFen) {
      skipped++;
      continue;
    }

    // Recycle ChessPGN instance periodically to release V8 buffer bloat
    if (processedCount > 0 && processedCount % RECYCLE_INTERVAL === 0) {
      chess = new ChessPGN();
    }
    processedCount++;

    // Debug: Check first unenriched game
    if (skipped === 0 && matched === 0 && unmatched === 0) {
      console.log(
        `\n  First unenriched game: idx=${game.idx}, has ecoJsonFen=${!!game.ecoJsonFen}`,
      );
    }

    try {
      // OPTIMIZATION: Parse moves manually instead of using loadPgn()
      // game.moves should contain just moves, but handle legacy data with headers too

      let movesText = game.moves;

      // Strip headers if present (legacy data compatibility)
      if (movesText.includes("[")) {
        movesText = movesText.replace(/^\[.*?\]\s*/gm, "").trim();
      }

      // Extract clean SAN moves
      const cleanMoves = movesText
        .replace(/\d+\.\s*/g, "") // Remove move numbers: "1." "2." etc.
        .replace(/1-0|0-1|1\/2-1\/2|\*/g, "") // Remove result tokens
        .replace(/\{[^}]*\}/g, "") // Remove comments
        .replace(/\([^)]*\)/g, "") // Remove variations
        .trim()
        .split(/\s+/)
        .filter((m) => m.length > 0 && m !== "");

      if (cleanMoves.length === 0) {
        unmatched++;
        continue;
      }

      // Reset shared instance then execute moves to build game state for lookupByMoves
      chess.reset();
      for (const move of cleanMoves) {
        const result = chess.move(move);
        if (!result) {
          throw new Error(`Invalid move: ${move}`);
        }
      }

      // Store ply count and clean SAN moves
      game.ply = cleanMoves.length;
      game.moves = cleanMoves.join(" ");

      const result = lookupByMoves(chess, openings, { positionBook });

      if (result.opening) {
        // Store eco.json match info with opening position FEN
        game.ecoJsonFen = openingToFen.get(result.opening) || chess.fen();
        game.ecoJsonOpening = result.opening.name;
        game.ecoJsonEco = result.opening.eco;
        game.movesBack = result.movesBack;
        matched++;
      } else {
        unmatched++;
      }
    } catch (error) {
      unmatched++;
    }
  }

  process.stdout.write(
    `\r  Processing: ${games.length}/${games.length} games complete!\n`,
  );
  console.log(`  ⏭️  Skipped: ${skipped} games (already enriched)`);
  console.log(
    `  ✅ Matched: ${matched} games (${(
      (matched / (games.length - skipped)) *
      100
    ).toFixed(1)}% of unenriched)`,
  );
  console.log(`  ⚠️  Unmatched: ${unmatched} games`);
}

function buildOpeningByFenIndex(games: GameMetadata[]): OpeningByFenIndex {
  console.log("\n📖 Building Opening by FEN index (eco.json positions)...");

  const index: OpeningByFenIndex = {};

  for (const game of games) {
    if (game.ecoJsonFen) {
      if (!index[game.ecoJsonFen]) {
        index[game.ecoJsonFen] = [];
      }
      index[game.ecoJsonFen].push(game.idx);
    }
  }

  console.log(
    `  ✅ Indexed ${Object.keys(index).length} unique eco.json positions`,
  );
  return index;
}

function buildOpeningByNameIndex(games: GameMetadata[]): OpeningByNameIndex {
  console.log("\n📖 Building Opening by Name index (eco.json names)...");

  const index: OpeningByNameIndex = {};

  for (const game of games) {
    // Use eco.json enriched opening name, FEN, and ECO
    const openingName = game.ecoJsonOpening;
    const fen = game.ecoJsonFen;
    const eco = game.ecoJsonEco;

    if (openingName && fen && eco) {
      if (!index[openingName]) {
        index[openingName] = {
          fen,
          eco,
          gameIds: [],
        };
      }
      index[openingName].gameIds.push(game.idx);
    }
  }

  console.log(
    `  ✅ Indexed ${Object.keys(index).length} unique eco.json opening names`,
  );
  return index;
}

function buildOpeningByEcoIndex(games: GameMetadata[]): OpeningByEcoIndex {
  console.log("\n🔖 Building Opening by ECO index...");

  const index: OpeningByEcoIndex = {};

  for (const game of games) {
    if (game.eco) {
      if (!index[game.eco]) {
        index[game.eco] = [];
      }
      index[game.eco].push(game.idx);
    }
  }

  console.log(`  ✅ Indexed ${Object.keys(index).length} unique ECO codes`);
  return index;
}

function buildPlayerIndex(games: GameMetadata[]): PlayerIndex {
  console.log("\n👤 Building Player index...");

  const index: PlayerIndex = {};

  for (const game of games) {
    // Index white player
    if (game.white) {
      const whiteName = game.white.toLowerCase().trim();
      if (!index[whiteName]) {
        index[whiteName] = { asWhite: [], asBlack: [], totalGames: 0 };
      }
      index[whiteName].asWhite.push(game.idx);
      index[whiteName].totalGames++;
    }

    // Index black player
    if (game.black) {
      const blackName = game.black.toLowerCase().trim();
      if (!index[blackName]) {
        index[blackName] = { asWhite: [], asBlack: [], totalGames: 0 };
      }
      index[blackName].asBlack.push(game.idx);
      index[blackName].totalGames++;
    }
  }

  console.log(`  ✅ Indexed ${Object.keys(index).length} unique players`);
  return index;
}

const ECO_LETTERS = ["A", "B", "C", "D", "E"] as const;
const MIN_PLAYER_GAMES = 100;

function buildPlayerEcoMatrix(games: GameMetadata[]): PlayerEcoMatrix {
  console.log("\n🎵 Building Player ECO matrix...");

  // Load master-ratings lookup (optional — missing entry is fine)
  let ratingsTable: Record<
    string,
    { peak: number; source: string; displayName: string }
  > = {};
  try {
    const ratingsPath = path.join(
      path.dirname(_require.resolve("./types.js")),
      "master-ratings.json",
    );
    ratingsTable = JSON.parse(fs.readFileSync(ratingsPath, "utf-8"));
  } catch {
    // Fallback: try relative to cwd
    try {
      ratingsTable = JSON.parse(
        fs.readFileSync("./scripts/master-ratings.json", "utf-8"),
      );
    } catch {
      console.warn(
        "  ⚠️  master-ratings.json not found — peak ratings will be omitted",
      );
    }
  }

  // First pass: accumulate raw counts per player per ECO letter/decade
  const raw: Record<
    string,
    { decades: Record<string, number[]>; total: number }
  > = {};

  for (const game of games) {
    if (!game.ecoJsonEco) continue;
    const ecoCode = game.ecoJsonEco.toUpperCase(); // e.g. "B90"
    const letter = ecoCode[0]; // "B"
    if (!ECO_LETTERS.includes(letter as (typeof ECO_LETTERS)[number])) continue;
    const decade = parseInt(ecoCode[1] ?? "0", 10); // 9

    const processPlayer = (name: string | undefined) => {
      if (!name) return;
      const key = name.toLowerCase().trim();
      if (!raw[key]) raw[key] = { decades: {}, total: 0 };
      if (!raw[key].decades[letter])
        raw[key].decades[letter] = new Array(10).fill(0);
      raw[key].decades[letter][decade]++;
      raw[key].total++;
    };

    processPlayer(game.white);
    processPlayer(game.black);
  }

  // Second pass: filter by min games and shape the output
  const players: PlayerEcoMatrix["players"] = {};
  let included = 0;

  for (const [key, data] of Object.entries(raw)) {
    if (data.total < MIN_PLAYER_GAMES) continue;

    const ratingEntry = ratingsTable[key];
    // Build a display name: prefer ratings table, else title-case the raw key
    const displayName =
      ratingEntry?.displayName ??
      key.replace(/(^|,\s*)(\w)/g, (_, sep, c) => sep + c.toUpperCase()).trim();

    const eco: PlayerEcoEntry["eco"] = {};
    for (const letter of ECO_LETTERS) {
      const decades = data.decades[letter] ?? new Array(10).fill(0);
      eco[letter] = { total: decades.reduce((s, v) => s + v, 0), decades };
    }

    const entry: PlayerEcoEntry = {
      displayName,
      totalGames: data.total,
      ...(ratingEntry
        ? { peakRating: ratingEntry.peak, ratingSource: ratingEntry.source }
        : {}),
      eco,
    };

    players[key] = entry;
    included++;
  }

  console.log(
    `  ✅ ${included} players included (>= ${MIN_PLAYER_GAMES} games); ${
      Object.keys(raw).length - included
    } filtered out`,
  );

  return {
    totalPlayers: included,
    minGames: MIN_PLAYER_GAMES,
    builtAt: new Date().toISOString(),
    players,
  };
}

function buildEventIndex(games: GameMetadata[]): EventIndex {
  console.log("\n🏆 Building Event index...");

  const index: EventIndex = {};

  for (const game of games) {
    if (game.event) {
      const normalized = game.event.toLowerCase().trim();

      if (!index[normalized]) {
        index[normalized] = [];
      }
      index[normalized].push(game.idx);
    }
  }

  console.log(`  ✅ Indexed ${Object.keys(index).length} unique events`);
  return index;
}

function buildDateIndex(games: GameMetadata[]): DateIndex {
  console.log("\n📅 Building Date index...");

  const index: DateIndex = {};

  for (const game of games) {
    if (game.date) {
      const year = game.date.split(".")[0];
      if (year && year !== "????") {
        if (!index[year]) {
          index[year] = [];
        }
        index[year].push(game.idx);
      }
    }
  }

  console.log(`  ✅ Indexed ${Object.keys(index).length} unique years`);
  return index;
}

function buildGameToPlayersIndex(games: GameMetadata[]): [string, string][] {
  console.log("\n🎮 Building Game-to-Players index...");

  // Create array where index = gameId
  const maxGameId = Math.max(...games.map((g) => g.idx));
  const index: [string, string][] = new Array(maxGameId + 1);

  for (const game of games) {
    index[game.idx] = [game.white || "Unknown", game.black || "Unknown"];
  }

  console.log(`  ✅ Indexed ${games.length} games (max ID: ${maxGameId})`);
  return index;
}

function buildGameToChunkIndex(
  loadedChunks: Array<{ chunkId: number; games: GameMetadata[] }>,
): Record<number, number> {
  console.log("\n🗂️  Building Game-to-Chunk index...");

  // Maps idx → chunkId so serverless functions can locate games without
  // relying on Math.floor(idx/4000), which only works for idx-sorted chunks.
  const index: Record<number, number> = {};

  for (const { chunkId, games } of loadedChunks) {
    for (const game of games) {
      index[game.idx] = chunkId;
    }
  }

  console.log(`  ✅ Indexed ${Object.keys(index).length} game locations`);
  return index;
}

async function buildIndexes(): Promise<void> {
  console.log("🔨 Phase 1: Building search indexes\n");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const chunkFiles = fs
    .readdirSync(OUTPUT_DIR)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".json"))
    .sort();

  // Load existing chunks preserving their structure.
  // Each loaded chunk keeps its games as a separate array so we know exactly
  // which games belong to which chunk file — no reshuffling.
  type LoadedChunk = { chunkId: number; games: GameMetadata[] };
  let loadedChunks: LoadedChunk[] = [];
  let allGames: GameMetadata[] = [];

  if (chunkFiles.length > 0) {
    console.log(`📦 Loading from ${chunkFiles.length} existing chunks...`);
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(OUTPUT_DIR, chunkFile);
      const chunk: GameIndexChunk = JSON.parse(
        fs.readFileSync(chunkPath, "utf-8"),
      );
      const chunkId = parseInt(
        chunkFile.replace("chunk-", "").replace(".json", ""),
        10,
      );
      loadedChunks.push({ chunkId, games: chunk.games });
      allGames = allGames.concat(chunk.games);
    }
    console.log(`  Found ${allGames.length} games\n`);
  } else if (fs.existsSync(INPUT_FILE)) {
    // Fallback: no chunks yet — load from processed-games.json (legacy initial import).
    console.log(`📖 Reading: ${INPUT_FILE}`);
    const data = JSON.parse(fs.readFileSync(INPUT_FILE, "utf-8"));
    allGames = data.games;
    // Treat all games as one chunk to seed the output
    loadedChunks = [{ chunkId: 0, games: allGames }];
    console.log(`  Found ${allGames.length} games\n`);
  } else {
    console.error(`❌ No data source found. Run download step first.`);
    process.exit(1);
  }

  const dedupPath = path.join(OUTPUT_DIR, "deduplication-index.json");
  const sourcePath = path.join(OUTPUT_DIR, "source-tracking.json");
  const deduplicationIndex = fs.existsSync(dedupPath)
    ? JSON.parse(fs.readFileSync(dedupPath, "utf-8"))
    : {};
  const sourceTracking = fs.existsSync(sourcePath)
    ? JSON.parse(fs.readFileSync(sourcePath, "utf-8"))
    : { pgnmentor: { lastPageVisit: new Date().toISOString(), files: {} } };

  // Load eco.json opening book
  console.log("📚 Loading eco.json opening book...");
  const openings = await openingBook();
  const positionBook = getPositionBook(openings);
  console.log(`  ✅ Loaded ${Object.keys(openings).length} openings\n`);

  // Track which game hashes get newly enriched so we know which chunks to rewrite
  const enrichedHashes = new Set<string>();
  const originallyEnriched = new Set(
    allGames.filter((g) => g.ecoJsonFen && g.hash).map((g) => g.hash),
  );

  // Enrich all games in-place
  await enrichGamesWithEcoJson(allGames, openings, positionBook);

  // Find newly enriched games
  for (const g of allGames) {
    if (g.ecoJsonFen && g.hash && !originallyEnriched.has(g.hash)) {
      enrichedHashes.add(g.hash);
    }
  }

  // Save chunks — only rewrite a chunk if it contains newly enriched games
  console.log("\n💾 Saving chunks...");
  let totalChunks = 0;
  for (const { chunkId, games } of loadedChunks) {
    totalChunks++;
    const chunkPath = path.join(OUTPUT_DIR, `chunk-${chunkId}.json`);
    const hasNewEnrichment = games.some(
      (g) => g.hash && enrichedHashes.has(g.hash),
    );

    if (!hasNewEnrichment && fs.existsSync(chunkPath)) {
      console.log(`  ✓  chunk-${chunkId}.json unchanged (skipped)`);
      continue;
    }

    const chunkData = { version: "1.0", chunkId, games };
    fs.writeFileSync(chunkPath, JSON.stringify(chunkData, null, 2));
    console.log(
      hasNewEnrichment
        ? `  ✅ chunk-${chunkId}.json (${games.length} games, enrichment updated)`
        : `  ✅ chunk-${chunkId}.json (written)`,
    );
  }

  // Rebuild master-index from actual on-disk chunks (don't invent chunk structure)
  const masterIndex: MasterIndex = {
    version: "1.0",
    totalGames: allGames.length,
    totalChunks,
    chunks: loadedChunks.map(({ chunkId, games }, i) => ({
      id: chunkId,
      blobKey: `master-games/chunks/chunk-${chunkId}.json`,
      startIdx: i * CHUNK_SIZE,
      endIdx: i * CHUNK_SIZE + games.length,
    })),
  };
  const masterPath = path.join(OUTPUT_DIR, "master-index.json");
  fs.writeFileSync(masterPath, JSON.stringify(masterIndex, null, 2));
  console.log(`  ✅ master-index.json`);

  // Build search indexes
  const openingByFen = buildOpeningByFenIndex(allGames);
  const openingByName = buildOpeningByNameIndex(allGames);
  const openingByEco = buildOpeningByEcoIndex(allGames);
  const playerIndex = buildPlayerIndex(allGames);
  const playerEcoMatrix = buildPlayerEcoMatrix(allGames);
  const eventIndex = buildEventIndex(allGames);
  const dateIndex = buildDateIndex(allGames);
  const gameToPlayers = buildGameToPlayersIndex(allGames);
  const gameToChunk = buildGameToChunkIndex(loadedChunks);

  // Save search indexes
  console.log("\n💾 Saving search indexes...");
  const indexes = [
    { name: "opening-by-fen.json", data: openingByFen },
    { name: "opening-by-name.json", data: openingByName },
    { name: "opening-by-eco.json", data: openingByEco },
    { name: "player-index.json", data: playerIndex },
    { name: "player-eco-matrix.json", data: playerEcoMatrix },
    { name: "event-index.json", data: eventIndex },
    { name: "date-index.json", data: dateIndex },
    { name: "game-to-players.json", data: gameToPlayers },
    { name: "game-to-chunk.json", data: gameToChunk },
    { name: "deduplication-index.json", data: deduplicationIndex },
    { name: "source-tracking.json", data: sourceTracking },
  ];

  for (const index of indexes) {
    const indexPath = path.join(OUTPUT_DIR, index.name);
    fs.writeFileSync(indexPath, JSON.stringify(index.data, null, 2));
    console.log(`  ✅ ${index.name}`);
  }

  // Size report
  console.log("\n📊 Index sizes:");
  const totalSize = indexes.reduce((sum, index) => {
    const indexPath = path.join(OUTPUT_DIR, index.name);
    const size = fs.statSync(indexPath).size;
    console.log(
      `  ${index.name.padEnd(30)} ${(size / 1024).toFixed(2).padStart(10)} KB`,
    );
    return sum + size;
  }, 0);

  const chunkSize = loadedChunks.reduce((sum, { chunkId }) => {
    const chunkPath = path.join(OUTPUT_DIR, `chunk-${chunkId}.json`);
    return sum + (fs.existsSync(chunkPath) ? fs.statSync(chunkPath).size : 0);
  }, 0);

  console.log(
    `  ${"Total indexes:".padEnd(30)} ${(totalSize / 1024).toFixed(2).padStart(10)} KB`,
  );
  console.log(
    `  ${"Total chunks:".padEnd(30)} ${(chunkSize / 1024).toFixed(2).padStart(10)} KB`,
  );
  console.log(
    `  ${"Grand total:".padEnd(30)} ${((totalSize + chunkSize) / 1024).toFixed(2).padStart(10)} KB`,
  );

  console.log("\n✅ Index building complete!");
  console.log("\nNext step: Upload to Netlify Blobs (requires netlify dev)");

  // Explicit exit to ensure process terminates cleanly
  process.exit(0);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildIndexes().catch((error) => {
    console.error("❌ Failed:", error);
    process.exit(1);
  });
}

export { buildIndexes };
