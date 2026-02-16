// Generate fromToPositionIndexed.json from eco.json's fromTo.json
// 
// TODO: This script should eventually be moved to eco.json.tooling repository
// where all eco.json data transformations belong. It's here temporarily for
// convenience during development. When eco.json.tooling is set up, move this
// script there and have eco.json publish fromToPositionIndexed.json on GitHub.
//
// Context: fensterchess needs position-indexed transitions for O(1) lookup.
// The raw fromTo.json from eco.json is an array format that requires O(n) search.
// This script pre-indexes by position-only FEN for efficient querying.

import fs from "fs";
import path from "path";

const FROM_TO_URL = "https://raw.githubusercontent.com/JeffML/eco.json/master/fromTo.json";
const OUTPUT_DIR = "./data/indexes";
const OUTPUT_FILE = "fromToPositionIndexed.json";

/**
 * Extract position-only part of FEN (first field before space)
 */
function getPosition(fen: string): string {
  return fen.split(" ")[0];
}

interface FromToIndexed {
  to: Record<string, string[]>;
  from: Record<string, string[]>;
}

async function generateFromToIndex() {
  console.log("🔄 Generating fromToPositionIndexed.json...\n");

  // Download fromTo.json from eco.json GitHub
  console.log(`📥 Downloading fromTo.json from eco.json...`);
  const response = await fetch(FROM_TO_URL);
  
  if (!response.ok) {
    throw new Error(`Failed to download fromTo.json: ${response.status}`);
  }

  const fromToArray: [string, string, string, string][] = await response.json();
  console.log(`  ✅ Downloaded ${fromToArray.length.toLocaleString()} transitions\n`);

  // Build position-indexed structure
  console.log(`🔨 Building position-indexed structure...`);
  const indexed: FromToIndexed = {
    to: {},
    from: {},
  };

  let processed = 0;
  const progressInterval = 1000;

  for (const [fromFen, toFen] of fromToArray) {
    processed++;
    
    if (processed % progressInterval === 0) {
      process.stdout.write(`\r  Processing: ${processed.toLocaleString()}...`);
    }

    // Extract positions (ignore turn, castling, etc.)
    const fromPosition = getPosition(fromFen);
    const toPosition = getPosition(toFen);

    // Index: from position -> which positions it leads TO
    if (!indexed.to[fromPosition]) {
      indexed.to[fromPosition] = [];
    }
    if (!indexed.to[fromPosition].includes(toFen)) {
      indexed.to[fromPosition].push(toFen);
    }

    // Index: to position -> which positions it came FROM
    if (!indexed.from[toPosition]) {
      indexed.from[toPosition] = [];
    }
    if (!indexed.from[toPosition].includes(fromFen)) {
      indexed.from[toPosition].push(fromFen);
    }
  }

  process.stdout.write(`\r  Processing: ${processed.toLocaleString()} complete!\n`);

  const toCount = Object.keys(indexed.to).length;
  const fromCount = Object.keys(indexed.from).length;
  console.log(`  ✅ Created ${toCount.toLocaleString()} 'to' positions`);
  console.log(`  ✅ Created ${fromCount.toLocaleString()} 'from' positions\n`);

  // Save to file
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);
  console.log(`💾 Writing to ${outputPath}...`);
  fs.writeFileSync(outputPath, JSON.stringify(indexed, null, 2));

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`  ✅ Saved ${sizeMB} MB\n`);

  console.log("✅ Generation complete!");
  console.log("\n📝 Remember: This transformation should eventually live in eco.json.tooling");
  
  process.exit(0);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateFromToIndex().catch((error) => {
    console.error("❌ Failed:", error);
    process.exit(1);
  });
}

export { generateFromToIndex };
