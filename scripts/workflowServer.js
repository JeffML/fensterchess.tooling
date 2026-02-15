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
        reject({ code, stdout, stderr, error: `Process exited with code ${code}` });
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
    
    if (chunksExist) {
      const files = fs.readdirSync(indexesDir);
      chunkCount = files.filter(f => f.startsWith("chunk-") && f.endsWith(".json")).length;
      indexCount = files.filter(f => 
        !f.startsWith("chunk-") && 
        f.endsWith(".json") && 
        !f.includes("deduplication") && 
        !f.includes("source-tracking")
      ).length;
      hasDedup = files.includes("deduplication-index.json");
      hasSourceTracking = files.includes("source-tracking.json");
    }

    const backupsDir = path.join(__dirname, "..", "backups");
    const backups = fs.existsSync(backupsDir) 
      ? fs.readdirSync(backupsDir).sort().reverse()
      : [];

    res.json({
      chunks: chunkCount,
      indexes: indexCount,
      hasDedup,
      hasSourceTracking,
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
    const env = maxFiles ? { MAX_FILES: maxFiles.toString() } : {};
    
    await runCommand("npm", ["run", "download:pgnmentor"], {
      env,
      onOutput: (data, type) => {
        res.write(`data: ${JSON.stringify({ type, output: data })}\n\n`);
      },
    });

    res.write(`data: ${JSON.stringify({ type: "done", success: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: "error", error: error.error || error.message })}\n\n`);
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
    res.write(`data: ${JSON.stringify({ type: "error", error: error.error || error.message })}\n\n`);
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
    res.write(`data: ${JSON.stringify({ type: "error", error: error.error || error.message })}\n\n`);
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
      res.write(`data: ${JSON.stringify({ type: "stdout", output: text })}\n\n`);
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      output += text;
      res.write(`data: ${JSON.stringify({ type: "stderr", output: text })}\n\n`);
    });

    // Auto-answer 'n' to the confirmation prompt
    setTimeout(() => {
      proc.stdin.write("n\n");
    }, 1000);

    proc.on("close", () => {
      res.write(`data: ${JSON.stringify({ type: "done", success: true, preview: output })}\n\n`);
      res.end();
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
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
      res.write(`data: ${JSON.stringify({ type: "stdout", output: data.toString() })}\n\n`);
    });

    proc.stderr.on("data", (data) => {
      res.write(`data: ${JSON.stringify({ type: "stderr", output: data.toString() })}\n\n`);
    });

    // Auto-answer 'y' to confirmation
    setTimeout(() => {
      proc.stdin.write("y\n");
    }, 1000);

    proc.on("close", (code) => {
      if (code === 0) {
        res.write(`data: ${JSON.stringify({ type: "done", success: true })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Process exited with code " + code })}\n\n`);
      }
      res.end();
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Workflow UI running at http://localhost:${PORT}`);
  console.log("   Open the URL in your browser to manage the data pipeline");
});
