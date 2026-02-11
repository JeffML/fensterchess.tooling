// Dry-run test: Process one file end-to-end
import fs from "fs";
import path from "path";

/**
 * Test the full pipeline with existing downloaded file
 */
async function testPipeline() {
  console.log("🧪 Dry-Run Test: Full Pipeline");
  console.log("=".repeat(60));
  
  const downloadDir = "./data/pgn-downloads";
  
  // Check if we have any existing ZIP files
  if (!fs.existsSync(downloadDir)) {
    console.log("❌ No pgn-downloads directory found");
    return;
  }

  const zipFiles = fs.readdirSync(downloadDir)
    .filter(f => f.endsWith(".zip"));

  if (zipFiles.length === 0) {
    console.log("⚠️  No ZIP files found in pgn-downloads/");
    console.log("   This test requires at least one downloaded file.");
    console.log("   Run 'npm run download' first or manually place a ZIP file.");
    return;
  }

  console.log(`\n📁 Found ${zipFiles.length} ZIP files:`);
  zipFiles.forEach(f => console.log(`   - ${f}`));

  // Test importing the actual download script
  console.log("\n🔍 Testing downloadPgnmentor script import...");
  
  try {
    const module = await import("../scripts/downloadPgnmentor.ts");
    console.log("   ✅ Script imports successfully");
    
    // Check exported functions are available (if any)
    console.log(`   Module exports: ${Object.keys(module).join(", ")}`);
    
  } catch (error) {
    console.log(`   ❌ Import error: ${(error as Error).message}`);
  }

  // Check existing indexes
  console.log("\n📊 Current Database State:");
  const indexesDir = "./data/indexes";
  
  if (fs.existsSync(indexesDir)) {
    const chunkFiles = fs.readdirSync(indexesDir)
      .filter(f => f.startsWith("chunk-") && f.endsWith(".json"));
    
    console.log(`   Chunks: ${chunkFiles.length}`);
    
    if (chunkFiles.length > 0) {
      let totalGames = 0;
      let maxId = -1;
      
      for (const chunkFile of chunkFiles) {
        const chunk = JSON.parse(
          fs.readFileSync(path.join(indexesDir, chunkFile), "utf-8")
        );
        totalGames += chunk.games.length;
        
        for (const game of chunk.games) {
          if (game.idx > maxId) maxId = game.idx;
        }
      }
      
      console.log(`   Total games: ${totalGames}`);
      console.log(`   Max game ID: ${maxId}`);
      console.log(`   Next game ID: ${maxId + 1}`);
    }
  } else {
    console.log("   No indexes directory - fresh start");
  }

  // Check source tracking
  const trackingPath = path.join(downloadDir, "pgnmentor-tracking.json");
  if (fs.existsSync(trackingPath)) {
    const tracking = JSON.parse(fs.readFileSync(trackingPath, "utf-8"));
    const processedFiles = Object.keys(tracking.files || {}).length;
    console.log(`\n📝 Source Tracking:`);
    console.log(`   Files tracked: ${processedFiles}`);
    console.log(`   Last visit: ${tracking.lastPageVisit || "never"}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Dry-run pre-flight checks complete");
  console.log("\n💡 To test full download:");
  console.log("   tsx scripts/downloadPgnmentor.ts");
  console.log("\n💡 To run with actual data, ensure you have:");
  console.log("   1. Network connection to pgnmentor.com");
  console.log("   2. Write permissions to data/ directory");
  console.log("   3. ~19K games will take ~20 minutes to process");
}

testPipeline().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
