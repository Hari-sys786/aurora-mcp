# aurora-mcp

MCP server exposing anonymous Google Play (via [aurora-cli](https://github.com/Hari-sys786/aurora-cli)) as tools.
Built on [mcp-use](https://github.com/mcp-use/mcp-use) (TypeScript). Standalone — the only external piece is the `aurora-cli` binary.

## Tools

| Tool | What it does |
|---|---|
| `search_apps(query, limit?)` | ranked keyword search → title/dev/pkg/version/size/icon |
| `app_info(package, versionCode?)` | full info incl. upload date, any historical version |
| `version_history(package, source?)` | complete history + dates (auto / play / exodus) |
| `download_apk(package, versionCode?)` | APK to **local path** (`downloads/<pkg>/<vc>/`), splits→zip, cached on disk |
| `token_status` | anonymous token health |

No Google credentials ever — anonymous token + spoofed device via aurora-cli.

## Run

```bash
npm install
npm run build
npm start        # http://localhost:3100/mcp  (+ built-in /inspector)
```

```bash
npx mcp-use client connect aurora http://localhost:3100/mcp
npx mcp-use client aurora tools list
npx mcp-use client aurora tools call search_apps query="barcode scanner"
```

## Config

| Env | Default |
|---|---|
| `PORT` | `3100` |
| `AURORA_CLI` | `../aurora-cli/aurora-cli-bin` |
| `AURORA_MCP_DL` | `<repo>/downloads` |
