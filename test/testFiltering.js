// Test game filtering and hash generation
// Phase 0 - Foundation
import { ChessPGN } from "@chess-pgn/chess-pgn";
import { shouldImportGame, stripAnnotations } from "../scripts/filterGame.js";
import { hashGame } from "../scripts/hashGame.js";

const testCases = [
  {
    description: "Valid master game",
    pgn: `[Event "Test Tournament"]
[White "Carlsen"]
[WhiteElo "2850"]
[Black "Nakamura"]
[BlackElo "2800"]
[Result "1-0"]

1. e4 e5 2. Nf3 {This is a comment} Nc6 (2... Nf6 3. Nxe5) 3. Bb5 1-0`,
    expected: true,
  },
  {
    description: "Variant game (Chess960)",
    pgn: `[Event "Variant Game"]
[Variant "Chess960"]
[White "Player1"]
[WhiteElo "2500"]
[Black "Player2"]
[BlackElo "2500"]
[Result "1-0"]

1. e4 e5 1-0`,
    expected: false,
    reason: "Variant chess",
  },
  {
    description: "Low rating game",
    pgn: `[Event "Low Rating Game"]
[White "Amateur"]
[WhiteElo "2200"]
[Black "Expert"]
[BlackElo "2450"]
[Result "1-0"]

1. e4 e5 1-0`,
    expected: false,
    reason: "Low rating",
  },
  {
    description: "FEN setup",
    pgn: `[Event "FEN Setup"]
[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]
[White "Player3"]
[WhiteElo "2600"]
[Black "Player4"]
[BlackElo "2600"]
[Result "1-0"]

1... e5 2. Nf3 1-0`,
    expected: false,
    reason: "FEN setup",
  },
  {
    description: "In-progress game (Result: *)",
    pgn: `[Event "Live Game"]
[White "Player5"]
[WhiteElo "2600"]
[Black "Player6"]
[BlackElo "2600"]
[Result "*"]

1. e4 e5 *`,
    expected: false,
    reason: "Game in progress",
  },
  {
    description: "Blitz game (TimeControl: 300+0)",
    pgn: `[Event "Blitz Tournament"]
[White "Player7"]
[WhiteElo "2700"]
[Black "Player8"]
[BlackElo "2700"]
[TimeControl "300+0"]
[Result "1-0"]

1. e4 e5 1-0`,
    expected: false,
    reason: "Fast time control",
  },
  {
    description: "Rapid game (TimeControl: 600+0)",
    pgn: `[Event "Rapid Tournament"]
[White "Player9"]
[WhiteElo "2700"]
[Black "Player10"]
[BlackElo "2700"]
[TimeControl "600+0"]
[Result "1-0"]

1. e4 e5 1-0`,
    expected: true,
  },
  {
    description: "Classical game (TimeControl: 40/7200)",
    pgn: `[Event "Classical Tournament"]
[White "Player11"]
[WhiteElo "2700"]
[Black "Player12"]
[BlackElo "2700"]
[TimeControl "40/7200"]
[Result "1-0"]

1. e4 e5 1-0`,
    expected: true,
  },
  {
    description: "Unknown time control (TimeControl: -)",
    pgn: `[Event "Unknown TC"]
[White "Player13"]
[WhiteElo "2700"]
[Black "Player14"]
[BlackElo "2700"]
[TimeControl "-"]
[Result "1-0"]

1. e4 e5 1-0`,
    expected: true,
  },
  {
    description: "Low rating bypassed with requireElo: false",
    pgn: `[Event "Open Tournament"]
[White "Amateur"]
[WhiteElo "2200"]
[Black "Expert"]
[BlackElo "2450"]
[Result "1-0"]

1. e4 e5 1-0`,
    options: { requireElo: false },
    expected: true,
  },
  {
    description: "requireTitles: true, both players have FIDE titles",
    pgn: `[Event "Titled Tournament"]
[White "GM Player"]
[WhiteElo "2700"]
[WhiteTitle "GM"]
[Black "IM Player"]
[BlackElo "2600"]
[BlackTitle "IM"]
[Result "1-0"]

1. e4 e5 1-0`,
    options: { requireTitles: true },
    expected: true,
  },
  {
    description: "requireTitles: true, black player lacks title",
    pgn: `[Event "Titled Tournament"]
[White "GM Player"]
[WhiteElo "2700"]
[WhiteTitle "GM"]
[Black "Untitled Player"]
[BlackElo "2600"]
[Result "1-0"]

1. e4 e5 1-0`,
    options: { requireTitles: true },
    expected: false,
    reason: "Missing FIDE title",
  },
];

async function testFiltering() {
  console.log("🧪 Testing game filtering logic...\n");

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const chess = new ChessPGN();
    chess.loadPgn(testCase.pgn);
    const header = chess.header();

    const result = shouldImportGame(chess, testCase.options);
    const ok = result === testCase.expected;

    if (ok) {
      console.log(`✅ ${testCase.description}`);
      if (result) {
        const pgn = chess.pgn();
        const cleaned = stripAnnotations(pgn);
        const preview =
          cleaned.length > 80 ? cleaned.substring(0, 80) + "..." : cleaned;
        console.log(`   Cleaned: ${preview}`);
        console.log(`   Hash: ${hashGame(header).substring(0, 16)}...`);
      }
      passed++;
    } else {
      console.log(`❌ ${testCase.description}`);
      console.log(
        `   Expected: ${testCase.expected ? "ACCEPT" : "REJECT"}, got: ${result ? "ACCEPT" : "REJECT"}`,
      );
      if (testCase.reason)
        console.log(`   Reason should be: ${testCase.reason}`);
      failed++;
    }
    console.log("");
  }

  console.log("─────────────────────────────");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("🎉 All filtering tests passed!");
  } else {
    console.log("❌ Some filtering tests failed!");
    process.exit(1);
  }
}

testFiltering().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
