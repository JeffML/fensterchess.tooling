# Migration Plan: Move Master Game Data to Netlify Blobs

## Current Problem

- **34 MB of data** committed to fensterchess git repository
- Data bundled with every deployment (slow, wasteful)
- Manual process to copy indexes from tooling to fensterchess

## Target Architecture

- Generate indexes in `fensterchess.tooling` → upload directly to Netlify Blobs
- Serverless functions in `fensterchess` → read from Blobs (not bundled files)
- No large data files in either git repository

---

## Step-by-Step Implementation

### **Phase 1: Set Up Blob Upload in fensterchess.tooling**

**1.1** Add `@netlify/blobs` to fensterchess.tooling dependencies

```bash
cd fensterchess.tooling
npm install @netlify/blobs
```

**1.2** Create `.env.example` with required credentials:

```bash
NETLIFY_AUTH_TOKEN=your-token-here
SITE_ID=your-site-id-here
```

**1.3** Create `scripts/uploadToBlobs.ts`:

- Read all files from local output directory (e.g., `./output/indexes/`)
- Upload each index file to Netlify Blobs with appropriate keys
- Report upload status and sizes

**1.4** Update `package.json` scripts:

```json
"upload": "tsx scripts/uploadToBlobs.ts"
```

**1.5** Update README with upload workflow

---

### **Phase 2: Update fensterchess Functions to Read from Blobs**

**2.1** Update serverless functions (one at a time for safety):

- `queryMasterGamesByFen.js` - Replace `fs.readFileSync()` with `store.get()`
- `getMasterGameMoves.js`
- `getMasterGameOpenings.js`
- etc.

**2.2** Pattern for migration:

```javascript
// OLD:
const data = JSON.parse(fs.readFileSync("data/indexes/opening-by-fen.json"));

// NEW:
import { getStore } from "@netlify/blobs";
const store = getStore("master-games");
const data = JSON.parse(await store.get("opening-by-fen.json"));
```

**2.3** Add caching strategy (Blobs are network calls):

- Cache index lookups in memory during cold starts
- Use `getWithMetadata()` for ETags/versioning

---

### **Phase 3: Clean Up fensterchess Repository**

**3.1** Add to `.gitignore`:

```
data/indexes/
data/pgn-downloads/
```

**3.2** Remove tracked files:

```bash
git rm -r --cached data/indexes/
git rm -r --cached data/pgn-downloads/
git commit -m "Remove large data files (now in Netlify Blobs)"
```

**3.3** Remove `included_files` from `netlify.toml`:

```toml
# DELETE all these sections:
[functions."queryMasterGamesByFen"]
   included_files = [...]
```

**3.4** Keep only essential data files:

- `data/scores.json` (small, used by scoresForFens function)
- `data/fromToPositionIndexed.json` (or migrate this too)

---

### **Phase 4: Update Workflow Documentation**

**4.1** Update fensterchess README:

- Remove references to copying data files
- Document that data lives in Netlify Blobs

**4.2** Update fensterchess.tooling README:

- Add upload instructions
- Document required env variables
- Explain Netlify auth token setup

**4.3** Update copilot-instructions.md in both repos

---

## Implementation Order (Safe Migration)

1. **Test environment setup** (can do immediately):
   - Set up `.env` in fensterchess.tooling with auth tokens
   - Test `uploadToBlobs.ts` script with existing index files

2. **Parallel operation** (low risk):
   - Keep files bundled in fensterchess
   - Add Blob uploads to tooling
   - Update ONE serverless function to read from Blobs as proof-of-concept
   - Test that function works

3. **Full migration** (after validation):
   - Migrate all remaining functions to Blobs
   - Remove data files from git
   - Update netlify.toml

4. **Cleanup** (final step):
   - Remove old index files from deployment
   - Update all documentation

---

## Questions to Resolve

1. **Blob organization**:
   - Single store "master-games" with all files?
   - Or separate stores by index type?

2. **Version management**:
   - How to handle index updates without breaking live site?
   - Blue/green deployment pattern with versioned keys?

3. **Local development**:
   - Should `netlify dev` work with local files or Blobs?
   - Keep small sample dataset for development?

4. **Authentication**:
   - Functions running on Netlify get automatic Blob access
   - Tooling needs explicit `NETLIFY_AUTH_TOKEN` + `SITE_ID`

---

## Benefits After Migration

- **Smaller git repositories**: No 34 MB of data committed
- **Faster deployments**: No need to bundle large files
- **Easier updates**: Update data without redeploying app
- **Separation of concerns**: Data pipeline completely separate from runtime
- **Scalability**: Can handle much larger datasets without bloating repository
