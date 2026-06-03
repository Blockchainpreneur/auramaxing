/**
 * Cross-platform binary resolution for Python & NotebookLM CLI.
 * Works on macOS (Framework, Homebrew, pyenv) and Linux.
 */
import { execSync } from 'child_process';

let _pythonCache = null;
let _nlmCache; // undefined = unresolved; null = resolved-to-none; object = { bin, args }

export function findPython() {
  if (_pythonCache) return _pythonCache;
  for (const bin of ['python3.12', 'python3', 'python']) {
    try {
      const p = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8', timeout: 1000 }).trim();
      if (p) { _pythonCache = p; return p; }
    } catch {}
  }
  _pythonCache = 'python3';
  return _pythonCache;
}

/** Internal: resolve NLM as structured { bin, args } or null. Cached (incl. the none result). */
function resolveNlm() {
  if (_nlmCache !== undefined) return _nlmCache;
  for (const bin of ['notebooklm', 'notebooklm-py']) {
    try {
      const p = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8', timeout: 1000 }).trim();
      if (p) { _nlmCache = { bin: p, args: [] }; return _nlmCache; }
    } catch {}
  }
  // Fallback: invoke as Python module if the package is installed
  try {
    const py = findPython();
    execSync(`${py} -c "import notebooklm" 2>/dev/null`, { timeout: 2000 });
    _nlmCache = { bin: py, args: ['-m', 'notebooklm'] };
    return _nlmCache;
  } catch {}
  _nlmCache = null;
  return null;
}

/**
 * Structured NLM invocation for spawn()/execFileSync(): { bin, args } or null.
 * Use this — NOT the string form — when passing to spawn/execFileSync, because spawn
 * does not shell-split "python3 -m notebooklm" into a bin + args (P0 audit finding #3).
 */
export function findNlmArgs() {
  return resolveNlm();
}

/** Legacy string form for shell-based (execSync template) callers, or null. */
export function findNlm() {
  const r = resolveNlm();
  if (!r) return null;
  return r.args.length ? `${r.bin} ${r.args.join(' ')}` : r.bin;
}

/** Returns env object with Python on PATH (no hardcoded paths) */
export function pythonEnv() {
  const pyBin = findPython();
  const slash = pyBin.lastIndexOf('/');
  if (slash === -1) return process.env; // bare name, let PATH resolve it
  const pyDir = pyBin.substring(0, slash);
  return { ...process.env, PATH: `${pyDir}:${process.env.PATH}` };
}
