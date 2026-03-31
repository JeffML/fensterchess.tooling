// Tests for game hashing and deduplication
import { normalizeGameForHash, hashGame } from "../scripts/hashGame.js";

let passed = 0;
let failed = 0;

function test(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

console.log("🧪 Testing hash game logic...\n");

// ── normalizeGameForHash ──────────────────────────────────────────────────────

console.log("📝 normalizeGameForHash\n");

const baseHeaders = {
  Event: "World Championship",
  White: "Carlsen",
  Black: "Caruana",
  Date: "2018.11.28",
  Round: "1",
};

test(
  normalizeGameForHash(baseHeaders) ===
    "world championship|carlsen|caruana|2018.11.28|1",
  "produces canonical pipe-delimited string",
);

test(
  normalizeGameForHash({
    Event: "TEST EVENT",
    White: "PLAYER ONE",
    Black: "PLAYER TWO",
    Date: "2024.01.01",
    Round: "?",
  }) === "test event|player one|player two|2024.01.01|?",
  "lowercases event and player names",
);

test(
  normalizeGameForHash({
    Event: "  Padded Event  ",
    White: " Carlsen ",
    Black: " Anand ",
    Date: "2024.01.01",
    Round: "1",
  }) === "padded event|carlsen|anand|2024.01.01|1",
  "trims surrounding whitespace",
);

test(
  normalizeGameForHash({}) === "||||",
  "handles missing headers (all fields empty)",
);

test(
  normalizeGameForHash({ White: "Carlsen", Black: "Anand" }) ===
    "|carlsen|anand||",
  "handles partially missing headers",
);

// ── hashGame ─────────────────────────────────────────────────────────────────

console.log("\n📝 hashGame\n");

const hash1 = hashGame(baseHeaders);
const hash2 = hashGame(baseHeaders);

test(
  hash1 === hash2,
  "same headers always produce the same hash (deterministic)",
);

test(hash1.length === 64, "produces a 64-character SHA-256 hex string");

test(/^[0-9a-f]{64}$/.test(hash1), "hash is lowercase hex");

const headersA = {
  Event: "Event A",
  White: "White A",
  Black: "Black A",
  Date: "2024.01.01",
  Round: "1",
};
const headersB = {
  Event: "Event B",
  White: "White B",
  Black: "Black B",
  Date: "2024.01.02",
  Round: "1",
};
test(
  hashGame(headersA) !== hashGame(headersB),
  "different games produce different hashes",
);

test(
  hashGame(baseHeaders) !== hashGame({ ...baseHeaders, Date: "2024.01.16" }),
  "different date produces different hash",
);

test(
  hashGame(baseHeaders) !== hashGame({ ...baseHeaders, Round: "6" }),
  "different round produces different hash",
);

// Case insensitivity — different casing on event/players should hash the same
const lowerHeaders = {
  Event: "world championship",
  White: "carlsen",
  Black: "caruana",
  Date: "2018.11.28",
  Round: "1",
};
const upperHeaders = {
  Event: "WORLD CHAMPIONSHIP",
  White: "CARLSEN",
  Black: "CARUANA",
  Date: "2018.11.28",
  Round: "1",
};
test(
  hashGame(lowerHeaders) === hashGame(upperHeaders),
  "case-insensitive: same game in different casing produces same hash",
);

// Date is NOT case-normalized (it's stored as-is)
test(
  hashGame({ ...baseHeaders, Date: "2018.11.28" }) === hashGame(baseHeaders),
  "date preserved as-is in hash",
);

// ─────────────────────────────────────────────────────────────────────────────

console.log("\n─────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("🎉 All hash tests passed!");
} else {
  console.log("❌ Some hash tests failed!");
  process.exit(1);
}
