/** aurora-mcp — exposes anonymous Google Play (aurora-cli) as MCP tools.
 *  Standalone project: only dependency is the aurora-cli binary (backend).
 *  download_apk returns a LOCAL file path (MCP runs on the same machine).
 *  Tools: search_apps, app_info, version_history, download_apk, token_status
 *  Run:  npm run build && npm start   ->  http://localhost:3100/mcp  (+ /inspector)
 */
import { MCPServer, text } from "mcp-use";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import AdmZip from "adm-zip";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const AURORA_CLI = process.env.AURORA_CLI || path.resolve(ROOT, "../aurora-cli/aurora-cli-bin");
const DL_ROOT = process.env.AURORA_MCP_DL || path.join(ROOT, "downloads");

async function cli(args: string[], timeoutMs = 300_000): Promise<string> {
  const { stdout } = await exec(AURORA_CLI, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function cliJson(args: string[]): Promise<any> {
  try {
    return JSON.parse(await cli(args));
  } catch {
    return null;
  }
}

function walk(d: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const server = new MCPServer({
  name: "aurora-mcp",
  title: "Aurora MCP",
  description: "Anonymous Google Play: search apps, full info, version history, APK download (local paths)",
  version: "2.0.0",
});

server.tool(
  {
    name: "search_apps",
    description: "Keyword search on Google Play (real ranked results). Returns title, developer, package, version, size, rating, icon.",
    schema: z.object({
      query: z.string().describe("App name / keyword (e.g. 'barcode scanner')"),
      limit: z.number().int().min(1).max(30).default(8),
    }),
  },
  async ({ query, limit }) => {
    const rows = (await cliJson(["search", query, "-n", String(limit), "--json"])) || [];
    return text(JSON.stringify({ count: rows.length, apps: rows }, null, 2));
  },
);

server.tool(
  {
    name: "app_info",
    description: "Full info for one package (any historical version via versionCode). Returns title, developer, version, upload date, size, rating, icon, whatsNew.",
    schema: z.object({
      package: z.string().describe("Package name, e.g. org.cris.aikyam"),
      versionCode: z.number().int().optional().describe("Optional historical versionCode"),
    }),
  },
  async ({ package: pkg, versionCode }) => {
    const args = ["info", pkg, ...(versionCode ? [String(versionCode)] : []), "--json"];
    const info = await cliJson(args);
    if (!info) return text(JSON.stringify({ error: `no info for ${pkg}` }));
    return text(JSON.stringify(info, null, 2));
  },
);

server.tool(
  {
    name: "version_history",
    description: "Complete version history with release dates. Auto-routes: dense codes -> Play sweep, sparse -> Exodus archive. Override with source.",
    schema: z.object({
      package: z.string(),
      source: z.enum(["auto", "play", "exodus"]).default("auto"),
      from: z.number().int().optional().describe("Manual Play sweep lower versionCode"),
      to: z.number().int().optional().describe("Manual Play sweep upper versionCode"),
    }),
  },
  async ({ package: pkg, source, from, to }) => {
    const args = from != null && to != null ? ["versions", pkg, String(from), String(to)] : ["versions", pkg, ...(source !== "auto" ? ["--source", source] : [])];
    try {
      return text((await cli(args, 600_000)) || "no versions found");
    } catch (e: any) {
      return text(JSON.stringify({ error: String(e.stderr || e).slice(-500) }));
    }
  },
);

server.tool(
  {
    name: "download_apk",
    description:
      "Download an APK (latest or exact versionCode) to this machine. Returns the absolute local file path (single .apk, or splits bundled into one .zip). Already-downloaded versions return the cached path instantly.",
    schema: z.object({
      package: z.string(),
      versionCode: z.number().int().optional().describe("Exact version; default latest"),
    }),
  },
  async ({ package: pkg, versionCode }): Promise<any> => {
    let vc = versionCode;
    if (!vc) {
      const info = await cliJson(["info", pkg, "--json"]);
      vc = info?.versionCode;
      if (!vc) return text(JSON.stringify({ error: `cannot resolve latest versionCode for ${pkg}` }));
    }
    const dir = path.join(DL_ROOT, pkg, String(vc));
    const existing = fs.existsSync(dir) ? walk(dir).filter((f) => fs.statSync(f).isFile()) : [];
    if (existing.length > 0) {
      const main = existing.find((f) => f.endsWith("bundle.zip")) || existing.find((f) => f.endsWith(".apk")) || existing[0];
      return text(
        JSON.stringify(
          {
            package: pkg,
            versionCode: vc,
            cached: true,
            file: path.basename(main),
            path: main,
            size_mb: +(fs.statSync(main).size / 1048576).toFixed(1),
            files: existing.map((f) => path.basename(f)),
          },
          null,
          2,
        ),
      );
    }
    fs.mkdirSync(dir, { recursive: true });
    try {
      await cli(["dl", pkg, String(vc), "-o", dir], 600_000);
    } catch (e: any) {
      fs.rmSync(dir, { recursive: true, force: true });
      return text(JSON.stringify({ error: `download failed: ${String(e.stderr || e).slice(-500)}` }));
    }
    let files = walk(dir).filter((f) => fs.statSync(f).isFile());
    if (files.length === 0) return text(JSON.stringify({ error: "no files delivered" }));
    let main: string;
    if (files.length > 1) {
      // bundle splits into one zip; drop loose apks
      const zip = new AdmZip();
      for (const f of files) zip.addLocalFile(f, "", path.basename(f));
      const bundle = path.join(dir, `${pkg}_${vc}_bundle.zip`);
      fs.writeFileSync(bundle, zip.toBuffer());
      for (const f of files) fs.rmSync(f, { force: true });
      main = bundle;
      files = [bundle];
    } else {
      main = files[0];
    }
    return text(
      JSON.stringify(
        {
          package: pkg,
          versionCode: vc,
          cached: false,
          file: path.basename(main),
          path: main,
          size_mb: +(fs.statSync(main).size / 1048576).toFixed(1),
          files: files.map((f) => path.basename(f)),
        },
        null,
        2,
      ),
    );
  },
);

server.tool(
  {
    name: "token_status",
    description: "Anonymous token status (email + hours remaining). No credentials ever used.",
    schema: z.object({}),
  },
  async () => text(await cli(["token"])),
);

const port = Number(process.env.PORT || 3100);
await server.listen(port);
console.log(`aurora-mcp running: http://localhost:${port}/mcp  | inspector: http://localhost:${port}/inspector | downloads: ${DL_ROOT}`);
