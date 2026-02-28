// Workflow UI server - runs data pipeline steps with validation
// Run with: npm run workflow
import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3030;

// Serve static files
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

// Helper to run npm commands and stream output
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, ...options.env },
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      if (options.onOutput) options.onOutput(output, "stdout");
    });

    proc.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      if (options.onOutput) options.onOutput(output, "stderr");
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        reject({
          code,
          stdout,
          stderr,
          error: `Process exited with code ${code}`,
        });
      }
    });

    proc.on("error", (error) => {
      reject({ error: error.message, stdout, stderr });
    });
  });
}

// Get current status of workflow
app.get("/api/status", async (req, res) => {
  try {
    const indexesDir = path.join(__dirname, "..", "data", "indexes");
    const chunksExist = fs.existsSync(indexesDir);

    let chunkCount = 0;
    let indexCount = 0;
    let hasDedup = false;
    let hasSourceTracking = false;
    let productionFileCount = 0;

    if (chunksExist) {
      const files = fs.readdirSync(indexesDir);
      chunkCount = files.filter(
        (f) => f.startsWith("chunk-") && f.endsWith(".json"),
      ).length;
      indexCount = files.filter(
        (f) =>
          !f.startsWith("chunk-") &&
          f.endsWith(".json") &&
          !f.includes("deduplication") &&
          !f.includes("source-tracking"),
      ).length;
      hasDedup = files.includes("deduplication-index.json");
      hasSourceTracking = files.includes("source-tracking.json");

      // Read production state from source-tracking.json
      if (hasSourceTracking) {
        try {
          const sourceTrackingPath = path.join(
            indexesDir,
            "source-tracking.json",
          );
          const tracking = JSON.parse(
            fs.readFileSync(sourceTrackingPath, "utf-8"),
          );
          productionFileCount = Object.keys(
            tracking.pgnmentor?.files || {},
          ).length;
        } catch (error) {
          // Ignore parse errors
        }
      }
    }

    const backupsDir = path.join(__dirname, "..", "backups");
    const backups = fs.existsSync(backupsDir)
      ? fs.readdirSync(backupsDir).sort().reverse()
      : [];

    res.json({
      local: {
        chunks: chunkCount,
        indexes: indexCount,
        hasDedup,
      },
      production: {
        filesUploaded: productionFileCount,
      },
      latestBackup: backups[0] || null,
      backupCount: backups.length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Step 1: Download new games
app.post("/api/download", async (req, res) => {
  const { maxFiles } = req.body;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    const env =
      maxFiles != null && maxFiles > 0
        ? { MAX_FILES: maxFiles.toString() }
        : {};

    await runCommand("npm", ["run", "download:pgnmentor"], {
      env,
      onOutput: (data, type) => {
        res.write(`data: ${JSON.stringify({ type, output: data })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: "done", success: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ type: "error", error: error.error || error.message })}\n\n`,
    );
    res.end();
  }
});

// Step 2: Build indexes
app.post("/api/build-indexes", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    await runCommand("npm", ["run", "build-indexes"], {
      onOutput: (data, type) => {
        res.write(`data: ${JSON.stringify({ type, output: data })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: "done", success: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ type: "error", error: error.error || error.message })}\n\n`,
    );
    res.end();
  }
});

// Step 3: Backup
app.post("/api/backup", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    await runCommand("npm", ["run", "backup"], {
      onOutput: (data, type) => {
        res.write(`data: ${JSON.stringify({ type, output: data })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: "done", success: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ type: "error", error: error.error || error.message })}\n\n`,
    );
    res.end();
  }
});

// Step 4: Upload (dry-run preview first)
app.post("/api/upload-preview", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    // Run upload but auto-answer 'n' to abort after preview
    const proc = spawn("npm", ["run", "upload"], {
      cwd: path.join(__dirname, ".."),
      shell: true,
    });

    let output = "";

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      res.write(
        `data: ${JSON.stringify({ type: "stdout", output: text })}\n\n`,
      );
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      output += text;
      res.write(
        `data: ${JSON.stringify({ type: "stderr", output: text })}\n\n`,
      );
    });

    // Auto-answer 'n' to the confirmation prompt
    setTimeout(() => {
      proc.stdin.write("n\n");
    }, 1000);

    proc.on("close", () => {
      res.write(
        `data: ${JSON.stringify({ type: "done", success: true, preview: output })}\n\n`,
      );
      res.end();
    });
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`,
    );
    res.end();
  }
});

// Step 4: Upload (confirmed)
app.post("/api/upload", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  try {
    const proc = spawn("npm", ["run", "upload"], {
      cwd: path.join(__dirname, ".."),
      shell: true,
    });

    proc.stdout.on("data", (data) => {
      res.write(
        `data: ${JSON.stringify({ type: "stdout", output: data.toString() })}\n\n`,
      );
    });

    proc.stderr.on("data", (data) => {
      res.write(
        `data: ${JSON.stringify({ type: "stderr", output: data.toString() })}\n\n`,
      );
    });

    // Auto-answer 'y' to confirmation
    setTimeout(() => {
      proc.stdin.write("y\n");
    }, 1000);

    proc.on("close", (code) => {
      if (code === 0) {
        res.write(
          `data: ${JSON.stringify({ type: "done", success: true })}\n\n`,
        );
      } else {
        res.write(
          `data: ${JSON.stringify({ type: "error", error: "Process exited with code " + code })}\n\n`,
        );
      }
      res.end();
    });
  } catch (error) {
    res.write(
      `data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`,
    );
    res.end();
  }
});

// List available backups with their stats
app.get("/api/backups", (req, res) => {
  try {
    const backupsDir = path.join(__dirname, "..", "backups");
    if (!fs.existsSync(backupsDir)) {
      return res.json({ backups: [] });
    }

    const dirs = fs
      .readdirSync(backupsDir)
      .filter((d) => fs.statSync(path.join(backupsDir, d)).isDirectory())
      .sort()
      .reverse();

    const backups = dirs.map((id) => {
      const indexesDir = path.join(backupsDir, id, "indexes");
      let chunkCount = 0;
      let totalGames = 0;

      if (fs.existsSync(indexesDir)) {
        const files = fs.readdirSync(indexesDir);
        const chunkFiles = files.filter(
          (f) => f.startsWith("chunk-") && f.endsWith(".json"),
        );
        chunkCount = chunkFiles.length;
        for (const f of chunkFiles) {
          try {
            const chunk = JSON.parse(
              fs.readFileSync(path.join(indexesDir, f), "utf-8"),
            );
            totalGames += (chunk.games || []).length;
          } catch (_) {
            // skip unreadable chunks
          }
        }
      }

      return { id, chunkCount, totalGames };
    });

    res.json({ backups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restore local data/indexes from a backup
app.post("/api/restore", (req, res) => {
  const { backupId } = req.body;
  if (!backupId) {
    return res.status(400).json({ error: "backupId is required" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (type, output) =>
    res.write(`data: ${JSON.stringify({ type, output })}\n\n`);

  try {
    const backupIndexesDir = path.join(
      __dirname,
      "..",
      "backups",
      backupId,
      "indexes",
    );
    const localIndexesDir = path.join(__dirname, "..", "data", "indexes");

    if (!fs.existsSync(backupIndexesDir)) {
      send("error", `Backup not found: ${backupId}`);
      res.end();
      return;
    }

    const files = fs
      .readdirSync(backupIndexesDir)
      .filter((f) => f.endsWith(".json"));

    if (!fs.existsSync(localIndexesDir)) {
      fs.mkdirSync(localIndexesDir, { recursive: true });
    }

    send(
      "stdout",
      `Restoring ${files.length} files from backup ${backupId}...\n`,
    );

    let copied = 0;
    for (const f of files) {
      const src = path.join(backupIndexesDir, f);
      const dst = path.join(localIndexesDir, f);
      fs.copyFileSync(src, dst);
      copied++;
      send("stdout", `  ✅ ${f}\n`);
    }

    // Remove any local files not in the backup (stale chunks from a bad run)
    const localFiles = fs
      .readdirSync(localIndexesDir)
      .filter((f) => f.endsWith(".json"));
    const backupSet = new Set(files);
    let removed = 0;
    for (const f of localFiles) {
      if (!backupSet.has(f)) {
        fs.unlinkSync(path.join(localIndexesDir, f));
        removed++;
        send("stdout", `  🗑️  Removed stale file: ${f}\n`);
      }
    }

    send(
      "stdout",
      `\nRestored ${copied} files, removed ${removed} stale files.\n`,
    );
    res.write(`data: ${JSON.stringify({ type: "done", success: true })}\n\n`);
    res.end();
  } catch (error) {
    send("error", error.message);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Workflow UI running at http://localhost:${PORT}`);
  console.log("   Open the URL in your browser to manage the data pipeline");
});
