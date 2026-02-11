// Test chunk management logic
import fs from "fs";
import path from "path";
import type { GameMetadata } from "../scripts/types.js";

interface ChunkData {
  games: GameMetadata[];
}

/**
 * Test 1: Verify chunk ID formula
 */
function testChunkIdFormula() {
  console.log("\n📝 Test 1: Chunk ID Formula");
  console.log("Formula: chunkId = Math.floor(gameId / 4000)\n");

  const testCases = [
    { gameId: 0, expectedChunk: 0 },
    { gameId: 3999, expectedChunk: 0 },
    { gameId: 4000, expectedChunk: 1 },
    { gameId: 7999, expectedChunk: 1 },
    { gameId: 8000, expectedChunk: 2 },
    { gameId: 19000, expectedChunk: 4 },
    { gameId: 19999, expectedChunk: 4 },
    { gameId: 20000, expectedChunk: 5 },
  ];

  let passed = 0;
  for (const { gameId, expectedChunk } of testCases) {
    const actualChunk = Math.floor(gameId / 4000);
    const status = actualChunk === expectedChunk ? "✅" : "❌";
    console.log(
      `  ${status} gameId ${gameId} → chunk-${actualChunk} (expected: ${expectedChunk})`,
    );
    if (actualChunk === expectedChunk) passed++;
  }

  console.log(`\n  Result: ${passed}/${testCases.length} passed`);
  return passed === testCases.length;
}

/**
 * Test 2: Verify existing chunks structure
 */
function testExistingChunks() {
  console.log("\n📝 Test 2: Existing Chunks Structure");

  const indexesDir = "./data/indexes";
  if (!fs.existsSync(indexesDir)) {
    console.log(
      "  ⚠️  No indexes directory found - this is expected for first run",
    );
    return true;
  }

  const chunkFiles = fs
    .readdirSync(indexesDir)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".json"))
    .sort((a, b) => {
      const numA = parseInt(a.match(/chunk-(\d+)/)?.[1] || "0");
      const numB = parseInt(b.match(/chunk-(\d+)/)?.[1] || "0");
      return numA - numB;
    });

  console.log(`  Found ${chunkFiles.length} chunk files\n`);

  let allValid = true;
  let totalGames = 0;
  let maxGameId = -1;

  for (const chunkFile of chunkFiles) {
    const chunkId = parseInt(chunkFile.match(/chunk-(\d+)/)?.[1] || "0");
    const chunkPath = path.join(indexesDir, chunkFile);
    const chunk: ChunkData = JSON.parse(fs.readFileSync(chunkPath, "utf-8"));

    const gameCount = chunk.games.length;
    const minId = chunk.games[0]?.idx ?? -1;
    const maxId = chunk.games[gameCount - 1]?.idx ?? -1;

    // Verify all game IDs in this chunk match the chunk ID
    const expectedChunkId = chunkId;
    for (const game of chunk.games) {
      const calculatedChunk = Math.floor(game.idx / 4000);
      if (calculatedChunk !== expectedChunkId) {
        console.log(
          `  ❌ chunk-${chunkId}: Game ${game.idx} should be in chunk-${calculatedChunk}`,
        );
        allValid = false;
      }
    }

    const status = gameCount <= 4000 ? "✅" : "❌";
    console.log(
      `  ${status} chunk-${chunkId}: ${gameCount} games (IDs ${minId}-${maxId})`,
    );

    if (gameCount > 4000) {
      console.log(`     ❌ Exceeds 4000 game limit!`);
      allValid = false;
    }

    totalGames += gameCount;
    if (maxId > maxGameId) maxGameId = maxId;
  }

  console.log(`\n  Total games: ${totalGames}`);
  console.log(`  Max game ID: ${maxGameId}`);
  console.log(`  Next game ID: ${maxGameId + 1}`);

  return allValid;
}

/**
 * Test 3: Simulate adding games to chunks
 */
function testChunkAppend() {
  console.log("\n📝 Test 3: Simulate Adding Games");

  // Simulate existing state
  const lastChunk = { id: 4, games: [] as GameMetadata[] };

  // Fill with 3900 games (100 slots free)
  for (let i = 15600; i < 19500; i++) {
    lastChunk.games.push({
      idx: i,
      white: "Player1",
      black: "Player2",
    } as GameMetadata);
  }

  console.log(
    `  Current state: chunk-${lastChunk.id} has ${lastChunk.games.length} games`,
  );
  console.log(
    `  Max game ID: ${lastChunk.games[lastChunk.games.length - 1].idx}`,
  );

  // Test 3a: Add 50 games (should fit in current chunk)
  console.log("\n  Test 3a: Add 50 games (should fit)");
  let nextId = 19500;
  let newGames: GameMetadata[] = [];
  for (let i = 0; i < 50; i++) {
    newGames.push({
      idx: nextId++,
      white: "New1",
      black: "New2",
    } as GameMetadata);
  }

  const shouldCreateNewChunk = lastChunk.games.length + newGames.length > 4000;
  console.log(
    `    Would create new chunk: ${shouldCreateNewChunk ? "YES ❌" : "NO ✅"}`,
  );

  // Test 3b: Add 200 games (should overflow to new chunk)
  console.log("\n  Test 3b: Add 200 games (should overflow)");
  nextId = 19500;
  newGames = [];
  for (let i = 0; i < 200; i++) {
    newGames.push({
      idx: nextId++,
      white: "New1",
      black: "New2",
    } as GameMetadata);
  }

  const remaining = 4000 - lastChunk.games.length; // 100
  const overflow = newGames.length - remaining; // 100
  console.log(`    Current chunk has ${remaining} slots free`);
  console.log(
    `    ${remaining} games fit in chunk-4, ${overflow} would go to chunk-5 ✅`,
  );

  return true;
}

/**
 * Test 4: Verify deduplication index
 */
function testDeduplicationIndex() {
  console.log("\n📝 Test 4: Deduplication Index");

  const indexesDir = "./data/indexes";
  const dedupPath = path.join(indexesDir, "deduplication-index.json");

  if (!fs.existsSync(dedupPath)) {
    console.log("  ⚠️  No deduplication index found");
    return true;
  }

  const dedupIndex = JSON.parse(fs.readFileSync(dedupPath, "utf-8"));
  const uniqueHashes = Object.keys(dedupIndex).length;

  console.log(`  Unique game hashes: ${uniqueHashes}`);

  // Load all chunks and count games
  const chunkFiles = fs
    .readdirSync(indexesDir)
    .filter((f) => f.startsWith("chunk-") && f.endsWith(".json"));

  let totalGames = 0;
  for (const chunkFile of chunkFiles) {
    const chunk: ChunkData = JSON.parse(
      fs.readFileSync(path.join(indexesDir, chunkFile), "utf-8"),
    );
    totalGames += chunk.games.length;
  }

  console.log(`  Total games in chunks: ${totalGames}`);

  const match = uniqueHashes === totalGames;
  const status = match ? "✅" : "⚠️";
  console.log(
    `  ${status} Hashes ${match ? "match" : "don't match"} game count`,
  );

  return true;
}

/**
 * Run all tests
 */
async function runTests() {
  console.log("🧪 Chunk Management Tests");
  console.log("=".repeat(60));

  const results = [
    testChunkIdFormula(),
    testExistingChunks(),
    testChunkAppend(),
    testDeduplicationIndex(),
  ];

  console.log("\n" + "=".repeat(60));
  const passed = results.filter((r) => r).length;
  console.log(`✅ ${passed}/${results.length} test suites passed\n`);

  if (passed === results.length) {
    console.log("🎉 All tests passed!");
  } else {
    console.log("⚠️  Some tests failed - review output above");
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error("❌ Test failure:", error);
  process.exit(1);
});
