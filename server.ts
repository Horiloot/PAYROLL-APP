import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./server/src/schema";
import { Actions } from "./server/src/actions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure persistent data directories exist
const DATA_DIR = path.resolve(__dirname, "data");
const BLOBS_DIR = path.resolve(DATA_DIR, "blobs");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BLOBS_DIR, { recursive: true });

// Setup SQLite / LibSQL client & Drizzle ORM
const dbPath = path.resolve(DATA_DIR, "payroll.db");
const client = createClient({ url: `file:${dbPath}` });
const db = drizzle(client, { schema });

// Run forward migrations if needed
async function initializeDatabase() {
  try {
    const check = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='roles'");
    if (check.rows.length === 0) {
      console.log("Initializing database schema from migrations...");
      const migrationFiles = [
        "0001_initial.sql",
        "0002_foundation_schema.sql",
        "0003_stage2_import_center.sql",
        "0004_stage3_production_data.sql",
        "0005_stage4_reconciliation_engine.sql",
        "0006_stage5_salary_engine.sql",
        "0007_stage6_master_salary_approval_exports.sql",
      ];
      for (const file of migrationFiles) {
        const fullPath = path.resolve(__dirname, "drizzle", file);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8");
          const statements = content
            .split("--> statement-breakpoint")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const stmt of statements) {
            await client.execute(stmt);
          }
        }
      }
      console.log("Database schema initialized successfully.");
    }
  } catch (err) {
    console.error("Error initializing database schema:", err);
  }
}

// In-memory + disk backed blob storage
interface StoredBlob {
  data: Uint8Array;
  contentType: string;
}
const blobMemoryStore = new Map<string, StoredBlob>();

const blobClient = {
  async put(key: string, data: Uint8Array, options?: { contentType?: string }) {
    const contentType = options?.contentType || "application/octet-stream";
    blobMemoryStore.set(key, { data, contentType });
    try {
      const safeKey = encodeURIComponent(key);
      const filePath = path.resolve(BLOBS_DIR, safeKey);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, Buffer.from(data));
    } catch (e) {
      console.error("Failed to write blob to disk:", e);
    }
  },
  async getUrl(key: string, _options?: { expiresInSeconds?: number }) {
    return `/api/blobs/${encodeURIComponent(key)}`;
  },
  async delete(key: string) {
    blobMemoryStore.delete(key);
    try {
      const safeKey = encodeURIComponent(key);
      const filePath = path.resolve(BLOBS_DIR, safeKey);
      await fs.promises.rm(filePath, { force: true });
    } catch {}
  },
  async get(key: string): Promise<StoredBlob | null> {
    if (blobMemoryStore.has(key)) {
      return blobMemoryStore.get(key)!;
    }
    try {
      const safeKey = encodeURIComponent(key);
      const filePath = path.resolve(BLOBS_DIR, safeKey);
      const data = await fs.promises.readFile(filePath);
      return { data: new Uint8Array(data), contentType: "application/octet-stream" };
    } catch {
      return null;
    }
  },
};

// Patch server-side global fetch for relative blob URLs
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (urlStr.startsWith("/api/blobs/") || urlStr.includes("/api/blobs/")) {
    const match = urlStr.match(/\/api\/blobs\/(.+)$/);
    if (match && match[1]) {
      const subpath = match[1].split("?")[0] || "";
      const key = decodeURIComponent(subpath);
      const blob = await blobClient.get(key);
      if (blob) {
        return new Response(Buffer.from(blob.data), {
          status: 200,
          headers: { "content-type": blob.contentType },
        });
      }
    }
  }
  return originalFetch(input, init);
};

async function startServer() {
  await initializeDatabase();

  const app = express();
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  // Typed Actions RPC Endpoint
  app.post(["/actions", "/actions/"], async (req, res) => {
    try {
      const { action, args, actionCallId } = req.body ?? {};
      if (!action || typeof action !== "string") {
        return res.status(400).json({ error: "Missing action name" });
      }

      const actionDef = (Actions as Record<string, any>)[action];
      if (!actionDef || typeof actionDef.handler !== "function") {
        return res.status(404).json({ error: `Action '${action}' not found` });
      }

      const ctx = {
        db: () => db,
        invalidateQueries: () => {},
        blobs: blobClient,
        agent: {} as any,
        inference: {} as any,
        tool: {} as any,
        emit: () => {},
        slug: "payroll-automation-platform",
        invocationId: actionCallId || "local",
        spaceDir: ".",
      };

      const parsedArgs = actionDef.request ? actionDef.request.parse(args ?? {}) : (args ?? {});
      const data = await actionDef.handler(ctx, parsedArgs);
      return res.json({ data });
    } catch (err: any) {
      const message = err?.message || "Action processing failed";
      return res.status(400).json({ error: message });
    }
  });

  // Blob Serving Endpoint (file downloads, chunk assemblies, exports)
  app.use("/api/blobs", async (req, res) => {
    if (req.method !== "GET") {
      return res.status(405).end();
    }
    const rawKey = req.path.replace(/^\//, "");
    const key = decodeURIComponent(rawKey);
    const blob = await blobClient.get(key);
    if (!blob) {
      return res.status(404).send("File not found");
    }
    res.setHeader("Content-Type", blob.contentType);
    res.send(Buffer.from(blob.data));
  });

  // Frontend Serving (Vite in dev mode, static files in production)
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.use((_req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || "0.0.0.0";

  app.listen(PORT, HOST, () => {
    console.log(`Payroll Automation Platform server running at http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
