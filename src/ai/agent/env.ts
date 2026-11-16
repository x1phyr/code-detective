import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Common user-level CLI installation directories often omitted when an IDE
 * (VS Code / Cursor / Antigravity) is launched from a desktop GUI rather than a shell.
 */
export function extraBinDirs(
  homeDir = os.homedir(),
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'win32') {
    const appData = env.APPDATA || path.win32.join(homeDir, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA || path.win32.join(homeDir, 'AppData', 'Local');
    const userProfile = env.USERPROFILE || homeDir;
    return [
      path.win32.join(appData, 'npm'),
      path.win32.join(userProfile, '.local', 'bin'),
      path.win32.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      path.win32.join(userProfile, '.cargo', 'bin'),
      path.win32.join(userProfile, '.bun', 'bin'),
    ];
  }

  return [
    path.posix.join(homeDir, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    path.posix.join(homeDir, '.npm-global', 'bin'),
    path.posix.join(homeDir, '.bun', 'bin'),
    path.posix.join(homeDir, '.cargo', 'bin'),
    path.posix.join(homeDir, 'Library', 'pnpm'),
    path.posix.join(homeDir, '.local', 'share', 'pnpm'),
    path.posix.join(homeDir, 'bin'),
  ];
}

/**
 * Returns a PATH string preserving existing entries first and appending any
 * missing standard CLI bin directories.
 */
export function augmentedPath(
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
): string {
  const delimiter = platform === 'win32' ? ';' : ':';
  const raw = baseEnv.PATH ?? baseEnv.Path ?? '';
  const existing = raw.split(delimiter).map(part => part.trim()).filter(Boolean);
  const seen = new Set(platform === 'win32' ? existing.map(p => p.toLowerCase()) : existing);
  const result = [...existing];

  for (const dir of extraBinDirs(homeDir, platform, baseEnv)) {
    const key = platform === 'win32' ? dir.toLowerCase() : dir;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(dir);
    }
  }
  return result.join(delimiter);
}

/** Builds a clean non-interactive environment for spawning local agent CLIs. */
export function agentEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PATH: augmentedPath(baseEnv),
    NO_COLOR: '1',
    CI: '1',
  };
}

function isRunnableFile(filePath: string, platform = process.platform): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function candidateNames(command: string, platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform !== 'win32') return [command];
  const extRaw = env.PATHEXT || '.EXE;.CMD;.BAT;.COM';
  const exts = extRaw.split(';').map(e => e.trim()).filter(Boolean);
  const lower = command.toLowerCase();
  if (exts.some(ext => lower.endsWith(ext.toLowerCase()))) return [command];
  return [command, ...exts.map(ext => `${command}${ext.toLowerCase()}`), ...exts.map(ext => `${command}${ext}`)];
}

/**
 * Resolves a command name or explicit path to an executable file on disk,
 * scanning the augmented PATH when `command` is a bare name.
 */
export function resolveExecutable(
  command: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;

  const isExplicit = trimmed.includes('/') || (platform === 'win32' && trimmed.includes('\\'));
  if (isExplicit) {
    for (const candidate of candidateNames(trimmed, platform, baseEnv)) {
      if (isRunnableFile(candidate, platform)) return candidate;
    }
    return undefined;
  }

  const delimiter = platform === 'win32' ? ';' : ':';
  const dirs = augmentedPath(baseEnv, platform, homeDir).split(delimiter).filter(Boolean);
  const names = candidateNames(trimmed, platform, baseEnv);

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = platform === 'win32' ? path.win32.join(dir, name) : path.join(dir, name);
      if (isRunnableFile(candidate, platform)) return candidate;
    }
  }
  return undefined;
}
