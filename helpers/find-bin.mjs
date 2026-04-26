/**
 * Cross-platform binary resolution for Python & NotebookLM CLI.
 * Works on macOS (Framework, Homebrew, pyenv) and Linux.
 */
import { execSync } from 'child_process';

let _pythonCache = null;
let _nlmCache = null;

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

export function findNlm() {
  if (_nlmCache) return _nlmCache;
  for (const bin of ['notebooklm', 'notebooklm-py']) {
    try {
      const p = execSync(`which ${bin} 2>/dev/null`, { encoding: 'utf8', timeout: 1000 }).trim();
      if (p) { _nlmCache = p; return p; }
    } catch {}
  }
  // Fallback: invoke as Python module if the package is installed
  try {
    const py = findPython();
    execSync(`${py} -c "import notebooklm" 2>/dev/null`, { timeout: 2000 });
    _nlmCache = `${py} -m notebooklm`;
    return _nlmCache;
  } catch {}
  _nlmCache = null;
  return null;
}

/** Returns env object with Python on PATH (no hardcoded paths) */
export function pythonEnv() {
  const pyBin = findPython();
  const slash = pyBin.lastIndexOf('/');
  if (slash === -1) return process.env; // bare name, let PATH resolve it
  const pyDir = pyBin.substring(0, slash);
  return { ...process.env, PATH: `${pyDir}:${process.env.PATH}` };
}
