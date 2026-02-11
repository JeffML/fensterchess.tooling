// Unit tests for batchCheckFileMetadata() function
// Tests concurrent HEAD request handling with mocked responses

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock fetch globally
const originalFetch = global.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

// Extract just the function we're testing (copy from downloadPgnmentor.ts)
const PGNMENTOR_BASE_URL = "https://www.pgnmentor.com";
const USER_AGENT =
  "Fenster Chess Opening Explorer (https://fensterchess.com) - Educational research project";

async function batchCheckFileMetadata(
  filenames: string[],
): Promise<Map<string, { lastModified?: string; etag?: string }>> {
  const results = new Map<string, { lastModified?: string; etag?: string }>();

  const promises = filenames.map(async (filename) => {
    const url = `${PGNMENTOR_BASE_URL}/players/${filename}`;

    try {
      const response = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
      });

      if (response.ok) {
        const lastModified = response.headers.get("last-modified") || undefined;
        const etag = response.headers.get("etag") || undefined;

        return {
          filename,
          metadata: { lastModified, etag },
          success: true,
        };
      } else {
        return {
          filename,
          metadata: {},
          success: false,
          status: response.status,
        };
      }
    } catch (error) {
      return {
        filename,
        metadata: {},
        success: false,
        error: (error as Error).message,
      };
    }
  });

  const allResults = await Promise.all(promises);

  for (const result of allResults) {
    if (result.success) {
      results.set(result.filename, result.metadata);
    }
  }

  return results;
}

describe("batchCheckFileMetadata", () => {
  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should successfully fetch metadata for all files", async () => {
    const filenames = ["Carlsen.zip", "Kasparov.zip", "Nakamura.zip"];

    mockFetch.mockImplementation((url: string) => {
      const filename = url.split("/").pop();
      return Promise.resolve({
        ok: true,
        headers: {
          get: (key: string) => {
            if (key === "last-modified") return `2024-12-${filename?.charAt(0)}0T10:00:00Z`;
            if (key === "etag") return `"etag-${filename}"`;
            return null;
          },
        },
      });
    });

    const result = await batchCheckFileMetadata(filenames);

    expect(result.size).toBe(3);
    expect(result.get("Carlsen.zip")).toEqual({
      lastModified: "2024-12-C0T10:00:00Z",
      etag: '"etag-Carlsen.zip"',
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("should handle mixed success and failure responses", async () => {
    const filenames = ["Success.zip", "NotFound.zip", "ServerError.zip"];

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("Success")) {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (key: string) => (key === "last-modified" ? "2024-12-01" : null),
          },
        });
      } else if (url.includes("NotFound")) {
        return Promise.resolve({ ok: false, status: 404 });
      } else {
        return Promise.resolve({ ok: false, status: 500 });
      }
    });

    const result = await batchCheckFileMetadata(filenames);

    expect(result.size).toBe(1); // Only successful one
    expect(result.get("Success.zip")).toEqual({
      lastModified: "2024-12-01",
      etag: undefined,
    });
    expect(result.has("NotFound.zip")).toBe(false);
    expect(result.has("ServerError.zip")).toBe(false);
  });

  it("should handle network errors gracefully", async () => {
    const filenames = ["File1.zip", "File2.zip"];

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("File1")) {
        return Promise.reject(new Error("Network timeout"));
      } else {
        return Promise.resolve({
          ok: true,
          headers: {
            get: () => "2024-12-01",
          },
        });
      }
    });

    const result = await batchCheckFileMetadata(filenames);

    expect(result.size).toBe(1); // Only File2 succeeded
    expect(result.has("File1.zip")).toBe(false);
    expect(result.get("File2.zip")).toBeDefined();
  });

  it("should handle empty filename list", async () => {
    const result = await batchCheckFileMetadata([]);

    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should handle responses with missing headers", async () => {
    const filenames = ["NoHeaders.zip"];

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: {
          get: () => null, // All headers return null
        },
      });
    });

    const result = await batchCheckFileMetadata(filenames);

    expect(result.size).toBe(1);
    expect(result.get("NoHeaders.zip")).toEqual({
      lastModified: undefined,
      etag: undefined,
    });
  });

  it("should make concurrent requests (all at once)", async () => {
    const filenames = Array.from({ length: 100 }, (_, i) => `File${i}.zip`);
    let concurrentCount = 0;
    let maxConcurrent = 0;

    mockFetch.mockImplementation(() => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);

      return new Promise((resolve) => {
        setTimeout(() => {
          concurrentCount--;
          resolve({
            ok: true,
            headers: { get: () => "2024-12-01" },
          });
        }, 10);
      });
    });

    const result = await batchCheckFileMetadata(filenames);

    expect(result.size).toBe(100);
    expect(maxConcurrent).toBeGreaterThan(10); // Should have many concurrent
    expect(mockFetch).toHaveBeenCalledTimes(100);
  });

  it("should pass correct User-Agent header", async () => {
    const filenames = ["Test.zip"];

    mockFetch.mockImplementation((url: string, options: any) => {
      expect(options.method).toBe("HEAD");
      expect(options.headers["User-Agent"]).toContain("Fenster Chess");
      return Promise.resolve({
        ok: true,
        headers: { get: () => null },
      });
    });

    await batchCheckFileMetadata(filenames);

    expect(mockFetch).toHaveBeenCalledWith(
      `${PGNMENTOR_BASE_URL}/players/Test.zip`,
      expect.objectContaining({
        method: "HEAD",
        headers: expect.objectContaining({
          "User-Agent": expect.stringContaining("Fenster Chess"),
        }),
      })
    );
  });
});
