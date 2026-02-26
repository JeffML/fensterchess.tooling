/**
 * rechunkByHash.ts
 *
 * One-time repair script: re-assigns all existing chunk games to stable,
 * hash-sorted chunks so future downloads never reshuffle existing data.
 *
 * What it does:
 *   1. Loads all games from every chunk-*.json in data/indexes/
 *   2. Deduplicates by hash (removes cross-source idx collisions)
 *   3. Sorts games by hash (deterministic, stable order)
 *   4. Re-slices into chunks of CHUNK_SIZE
 *   5. Writes new chunk-*.json files (deletes old ones if count changed)
 *   6. Rewrites master-index.json
 *
 * After running this, run upload to push all chunks to production once.
 * Going forward, buildIndexes will also sort by hash so new games only ever
 * touch the chunk at their insertion point.
 *
 * Usage:  npx tsx scripts/rechunkByHash.ts
 */

import fs from "fs";
import path from "path";

const CHUNK_SIZE = 4000;
const INDEXES_DIR = "./data/indexes";

interface GameMetadata {
  idx: number;
  hash: string;
  [key: string]: unknown;
}

interface GameIndexChunk {
  version: string;
  chunkId: number;
  startIdx: number;
  endIdx: number;
  games: GameMetadata[];
}

async function rechunk(): Promise<void> {
  console.log("🔄 Re-chunking all games by hash...\n");

  // 1. Load all games from existing chunks
  const chunkFiles = fs
    .readdirSync(INDEXES_DIR)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".json"))
    .sort();

  if (chunkFiles.length === 0) {
    console.error("❌ No chunk files found in", INDEXES_DIR);
    process.exit(1);
  }

  console.log(`📦 Loading ${chunkFiles.length} existing chunks...`);
  const allGames: GameMetadata[] = [];
  for (const f of chunkFiles) {
    const chunk: GameIndexChunk = JSON.parse(
      fs.readFileSync(path.join(INDEXES_DIR, f), "utf-8"),
    );
    allGames.push(...chunk.games);
  }
  console.log(`  Loaded ${allGames.length} total game records`);

  // 2. Deduplicate by hash
  const seen = new Set<string>();
  const deduped: GameMetadata[] = [];
  let dupes = 0;
  for (const g of allGames) {
    if (!g.hash) {
      // No hash — keep as-is (shouldn't happen in practice)
      deduped.push(g);
      continue;
    }
    if (seen.has(g.hash)) {
      dupes++;
    } else {
      seen.add(g.hash);
      deduped.push(g);
    }
  }
  console.log(`  Deduplicated: removed ${dupes} duplicate records`);
  console.log(`  Unique games: ${deduped.length}\n`);

  // 3. Sort by hash for stable, deterministic ordering
  deduped.sort((a, b) => {
    if (a.hash < b.hash) return -1;
    if (a.hash > b.hash) return 1;
    return 0;
  });

  // 4. Re-slice into chunks
  const totalChunks = Math.ceil(deduped.length / CHUNK_SIZE);
  const newChunks: GameIndexChunk[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, deduped.length);
    newChunks.push({
      version: "1.0",
      chunkId: i,
      startIdx: start,
      endIdx: end,
      games: deduped.slice(start, end),
    });
    console.log(
      `  Chunk ${i}: ${end - start} games (positions ${start}–${end - 1})`,
    );
  }

  // 5. Delete any old chunks beyond the new count (in case count shrank)
  for (const f of chunkFiles) {
    const oldId = parseInt(f.replace("chunk-", "").replace(".json", ""), 10);
    if (oldId >= totalChunks) {
      fs.unlinkSync(path.join(INDEXES_DIR, f));
      console.log(`  🗑️  Removed stale ${f}`);
    }
  }

  // 6. Write new chunk files
  console.log(`\n💾 Writing ${totalChunks} rechunked files...`);
  for (const chunk of newChunks) {
    const chunkPath = path.join(INDEXES_DIR, `chunk-${chunk.chunkId}.json`);
    fs.writeFileSync(chunkPath, JSON.stringify(chunk, null, 2));
    console.log(`  ✅ chunk-${chunk.chunkId}.json`);
  }

  // 7. Rewrite master-index.json
  const masterIndex = {
    version: "1.0",
    totalGames: deduped.length,
    totalChunks,
    chunks: newChunks.map((c) => ({
      id: c.chunkId,
      blobKey: `master-games/chunks/chunk-${c.chunkId}.json`,
      startIdx: c.startIdx,
      endIdx: c.endIdx,
    })),
  };
  const masterPath = path.join(INDEXES_DIR, "master-index.json");
  fs.writeFileSync(masterPath, JSON.stringify(masterIndex, null, 2));
  console.log(`  ✅ master-index.json`);

  console.log(`\n✅ Rechunk complete.`);
  console.log(`   Total unique games: ${deduped.length}`);
  console.log(`   Total chunks:       ${totalChunks}`);
  console.log(
    `\n⚠️  All chunks have changed. Run upload to push everything to production.`,
  );
}

rechunk().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
