#!/usr/bin/env node
/**
 * AURAMAXING NLM Cookie Sync (raw CDP, fast path)
 *
 * Extracts NotebookLM auth cookies directly from the user's running Chrome
 * via CDP — no Playwright, no page navigation, no networkidle hangs.
 *
 * Why this exists: helpers/nlm-auth-refresh.mjs uses Playwright with
 * `wait_until="networkidle"` which routinely times out (Google's pages
 * never settle) — even when Chrome already has a live notebooklm tab and
 * valid session. This helper reads cookies from the live tab in <2s.
 *
 * Requires:
 *   - browser-server.mjs running on :9222
 *   - User signed into notebooklm.google.com in that Chrome window
 *
 * Implementation: shells out to a tiny embedded Python script that calls
 * Network.getCookies on the page-level CDP WS. Python keeps us dependency-
 * free on the Node side (no `ws` npm package needed).
 *
 * Output: ~/.notebooklm/storage_state.json (Playwright-format)
 *
 * Exit codes:
 *   0  cookies saved
 *   1  no Google tab open
 *   2  CDP unreachable
 *   3  no SID/HSID/APISID — user is logged out in Chrome
 *   4  python or required modules missing
 */
import { execSync, spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { findPython } from './find-bin.mjs';

const HOME = homedir();
const STORAGE_STATE = join(HOME, '.notebooklm', 'storage_state.json');

function log(msg) { process.stderr.write(`[nlm-cookie-sync] ${msg}\n`); }

const PY_SCRIPT = `
import asyncio, json, os, sys, urllib.request

try:
    import websockets
except ImportError:
    print("MISSING_WEBSOCKETS", flush=True); sys.exit(4)

OUT = os.path.expanduser("~/.notebooklm/storage_state.json")

def normalize_same_site(s):
    if not s: return "Lax"
    cap = s[0].upper() + s[1:].lower()
    return cap if cap in ("Strict", "Lax", "None") else "Lax"

async def main():
    try:
        with urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=3) as r:
            targets = json.load(r)
    except Exception as e:
        print(f"CDP_UNREACHABLE:{e}", flush=True); sys.exit(2)

    page = None
    for t in targets:
        if t.get("type") == "page" and "notebooklm.google.com" in (t.get("url") or ""):
            page = t; break
    if not page:
        for t in targets:
            if t.get("type") == "page" and "google.com" in (t.get("url") or ""):
                page = t; break
    if not page:
        print("NO_GOOGLE_TAB", flush=True); sys.exit(1)

    print(f"USING_TAB:{(page.get('url') or '')[:80]}", flush=True)

    ws_url = page["webSocketDebuggerUrl"]
    async with websockets.connect(ws_url, max_size=20*1024*1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Network.getCookies"}))
        for _ in range(30):
            msg = await asyncio.wait_for(ws.recv(), timeout=10)
            data = json.loads(msg)
            if data.get("id") == 1:
                cookies = data.get("result", {}).get("cookies", [])
                google = [c for c in cookies if "google.com" in c.get("domain", "")]
                names = {c.get("name") for c in google}
                if not (("SID" in names) and ("HSID" in names) and ("APISID" in names)):
                    print(f"MISSING_AUTH:SID={('SID' in names)} HSID={('HSID' in names)} APISID={('APISID' in names)}", flush=True)
                    sys.exit(3)
                pw = []
                for c in google:
                    pw.append({
                        "name": c.get("name"),
                        "value": c.get("value"),
                        "domain": c.get("domain"),
                        "path": c.get("path", "/"),
                        "expires": c.get("expires", -1) if isinstance(c.get("expires"), (int, float)) else -1,
                        "httpOnly": bool(c.get("httpOnly", False)),
                        "secure": bool(c.get("secure", False)),
                        "sameSite": normalize_same_site(c.get("sameSite")),
                    })
                storage = {"cookies": pw, "origins": []}
                os.makedirs(os.path.dirname(OUT), exist_ok=True)
                tmp = OUT + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(storage, f, indent=2)
                os.replace(tmp, OUT)
                print(f"COOKIES_SAVED:{len(pw)}", flush=True)
                return
        print("NO_RESPONSE", flush=True); sys.exit(2)

asyncio.run(main())
`;

function main() {
  const py = findPython();
  if (!py) { log('No python3 available'); process.exit(4); }

  const scriptPath = join(tmpdir(), `nlm-cookie-sync-${process.pid}.py`);
  writeFileSync(scriptPath, PY_SCRIPT);

  try {
    const res = spawnSync(py, [scriptPath], {
      encoding: 'utf8',
      timeout: 25000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = res.stdout || '';
    const stderr = res.stderr || '';
    if (stdout.trim()) log(stdout.trim().replace(/\n/g, ' | '));
    if (stderr.trim() && process.env.NLM_DEBUG) log('stderr: ' + stderr.trim().slice(0, 300));

    if (res.signal === 'SIGTERM' || res.error) {
      log(`python invocation failed: ${res.error?.message || res.signal}`);
      process.exit(2);
    }
    process.exit(res.status ?? 0);
  } finally {
    try { unlinkSync(scriptPath); } catch {}
  }
}

main();
