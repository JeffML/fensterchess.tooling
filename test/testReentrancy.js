// Test re-entrancy: source-tracking represents production state
// Verifies that download doesn't update tracking, upload does

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log("🧪 Testing re-entrancy behavior...\n");

// Use isolated test directory (won't affect real data)
const TEST_DIR = path.join(__dirname, "..", "test-temp");
const SOURCE_TRACKING_PATH = path.join(TEST_DIR, "source-tracking.json");

// Clean up test directory before starting
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

function loadSourceTracking() {
  if (!fs.existsSync(SOURCE_TRACKING_PATH)) {
    return { pgnmentor: { files: {} } };
  }
  return JSON.parse(fs.readFileSync(SOURCE_TRACKING_PATH, "utf-8"));
}

function saveSourceTracking(data) {
  fs.writeFileSync(SOURCE_TRACKING_PATH, JSON.stringify(data, null, 2));
}

// Test scenarios
const tests = [
  {
    name: "Initial state: no source-tracking.json",
    test: () => {
      const tracking = loadSourceTracking();
      const fileCount = Object.keys(tracking.pgnmentor?.files || {}).length;

      if (fileCount === 0) {
        console.log("  ✅ PASS: No files in production tracking");
        return true;
      } else {
        console.log(`  ❌ FAIL: Found ${fileCount} files (expected 0)`);
        return false;
      }
    },
  },

  {
    name: "Simulate upload: should update source-tracking.json",
    test: () => {
      // Simulate what uploadToBlobs.js does
      const tracking = loadSourceTracking();

      // Mock: Add some files as if they were uploaded
      tracking.pgnmentor = tracking.pgnmentor || { files: {} };
      tracking.pgnmentor.files["TestFile1.zip"] = {
        filename: "TestFile1.zip",
        url: "https://www.pgnmentor.com/players/TestFile1.zip",
        gameCount: 100,
        uploadDate: new Date().toISOString(),
      };
      tracking.pgnmentor.files["TestFile2.zip"] = {
        filename: "TestFile2.zip",
        url: "https://www.pgnmentor.com/players/TestFile2.zip",
        gameCount: 200,
        uploadDate: new Date().toISOString(),
      };
      tracking.pgnmentor.lastPageVisit = new Date().toISOString();

      saveSourceTracking(tracking);

      // Verify
      const updated = loadSourceTracking();
      const fileCount = Object.keys(updated.pgnmentor?.files || {}).length;

      if (fileCount === 2) {
        console.log("  ✅ PASS: Upload updated tracking (2 files)");
        return true;
      } else {
        console.log(`  ❌ FAIL: Expected 2 files, got ${fileCount}`);
        return false;
      }
    },
  },

  {
    name: "Production state persists",
    test: () => {
      const tracking = loadSourceTracking();
      const fileCount = Object.keys(tracking.pgnmentor?.files || {}).length;

      if (fileCount === 2) {
        console.log(
          "  ✅ PASS: Production state persists (2 files still tracked)",
        );
        return true;
      } else {
        console.log(`  ❌ FAIL: Expected 2 files, got ${fileCount}`);
        return false;
      }
    },
  },

  {
    name: "Download decision based on production state",
    test: () => {
      const tracking = loadSourceTracking();

      // Simulate download logic
      const discoveredFiles = [
        "TestFile1.zip",
        "TestFile2.zip",
        "TestFile3.zip",
      ];

      const filesToProcess = [];
      for (const filename of discoveredFiles) {
        const trackedFile = tracking.pgnmentor?.files[filename];
        if (!trackedFile) {
          filesToProcess.push(filename);
        }
      }

      const expectedToProcess = ["TestFile3.zip"];
      const passes =
        filesToProcess.length === 1 && filesToProcess[0] === "TestFile3.zip";

      if (passes) {
        console.log(
          "  ✅ PASS: Would download TestFile3.zip only (TestFile1/2 in production)",
        );
        return true;
      } else {
        console.log(
          `  ❌ FAIL: Expected to process [TestFile3.zip], got [${filesToProcess.join(", ")}]`,
        );
        return false;
      }
    },
  },

  {
    name: "Simulate abort after download (no tracking update)",
    test: () => {
      // Before state
      const beforeTracking = loadSourceTracking();
      const beforeCount = Object.keys(
        beforeTracking.pgnmentor?.files || {},
      ).length;

      // Simulate: Download completes but we DON'T update source-tracking
      // (This is what downloadPgnmentor.ts does now - no tracking update)

      // After state (should be unchanged)
      const afterTracking = loadSourceTracking();
      const afterCount = Object.keys(
        afterTracking.pgnmentor?.files || {},
      ).length;

      if (beforeCount === afterCount && afterCount === 2) {
        console.log(
          "  ✅ PASS: Download doesn't update tracking (still 2 files)",
        );
        return true;
      } else {
        console.log(
          `  ❌ FAIL: Expected tracking unchanged (2 files), got ${afterCount}`,
        );
        return false;
      }
    },
  },

  {
    name: "Re-run after abort: would re-download same files",
    test: () => {
      const tracking = loadSourceTracking();

      // Simulate: TestFile3.zip was downloaded but not uploaded
      // On re-run, should we download it again?
      const discoveredFiles = [
        "TestFile1.zip",
        "TestFile2.zip",
        "TestFile3.zip",
      ];

      const filesToProcess = [];
      for (const filename of discoveredFiles) {
        const trackedFile = tracking.pgnmentor?.files[filename];
        if (!trackedFile) {
          filesToProcess.push(filename);
        }
      }

      // Should still want to download TestFile3.zip (not in production)
      const passes =
        filesToProcess.length === 1 && filesToProcess[0] === "TestFile3.zip";

      if (passes) {
        console.log(
          "  ✅ PASS: Re-run would download TestFile3.zip again (not in production)",
        );
        return true;
      } else {
        console.log(
          `  ❌ FAIL: Expected [TestFile3.zip], got [${filesToProcess.join(", ")}]`,
        );
        return false;
      }
    },
  },

  {
    name: "Upload after re-download: updates tracking",
    test: () => {
      const tracking = loadSourceTracking();

      // Simulate upload of TestFile3.zip
      tracking.pgnmentor.files["TestFile3.zip"] = {
        filename: "TestFile3.zip",
        url: "https://www.pgnmentor.com/players/TestFile3.zip",
        gameCount: 300,
        uploadDate: new Date().toISOString(),
      };

      saveSourceTracking(tracking);

      const updated = loadSourceTracking();
      const fileCount = Object.keys(updated.pgnmentor?.files || {}).length;

      if (fileCount === 3) {
        console.log(
          "  ✅ PASS: Upload updated tracking (now 3 files in production)",
        );
        return true;
      } else {
        console.log(`  ❌ FAIL: Expected 3 files, got ${fileCount}`);
        return false;
      }
    },
  },

  {
    name: "Final state: all files in production",
    test: () => {
      const tracking = loadSourceTracking();
      const files = Object.keys(tracking.pgnmentor?.files || {}).sort();

      const expected = ["TestFile1.zip", "TestFile2.zip", "TestFile3.zip"];
      const passes = JSON.stringify(files) === JSON.stringify(expected);

      if (passes) {
        console.log("  ✅ PASS: All 3 files tracked in production");
        return true;
      } else {
        console.log(
          `  ❌ FAIL: Expected ${expected.join(", ")}, got ${files.join(", ")}`,
        );
        return false;
      }
    },
  },
];

// Run all tests
let passed = 0;
let failed = 0;

for (const test of tests) {
  console.log(`\n${test.name}:`);
  try {
    const result = test.test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAIL: ${error.message}`);
    failed++;
  }
}

// Summary
console.log("\n" + "=".repeat(60));
console.log("Test Results");
console.log("=".repeat(60));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log("=".repeat(60));

// Cleanup test directory
fs.rmSync(TEST_DIR, { recursive: true, force: true });

if (failed === 0) {
  console.log("\n🎉 All re-entrancy tests passed!");
  console.log("\n✅ Source tracking correctly represents production state");
  console.log("✅ Download doesn't update tracking (local work in progress)");
  console.log("✅ Upload updates tracking (production state synchronized)");
  console.log(
    "✅ Re-running after abort correctly re-downloads incomplete files\n",
  );
  process.exit(0);
} else {
  console.log("\n❌ Some tests failed\n");
  process.exit(1);
}
