import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const WINDOWS_EXECUTABLE_SUFFIXES = [".cmd", ".exe", ".bat", ".com"];

function isWindows(): boolean {
  return process.platform === "win32";
}

function looksLikePath(command: string): boolean {
  return (
    command.startsWith(".") ||
    command.includes("/") ||
    command.includes("\\") ||
    /^[A-Za-z]:/.test(command)
  );
}

function hasWindowsSuffix(command: string): boolean {
  const lower = command.toLowerCase();
  return WINDOWS_EXECUTABLE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function locateWithSystem(command: string): string | null {
  const locator = isWindows() ? "where.exe" : "which";
  const result = spawnSync(locator, [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }

  const matched = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return matched ?? null;
}

export function resolveCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }

  if (looksLikePath(trimmed)) {
    if (existsSync(trimmed)) {
      return trimmed;
    }
    if (isWindows() && !hasWindowsSuffix(trimmed)) {
      for (const suffix of WINDOWS_EXECUTABLE_SUFFIXES) {
        const candidate = `${trimmed}${suffix}`;
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  const lookupCandidates =
    isWindows() && !hasWindowsSuffix(trimmed)
      ? [trimmed, ...WINDOWS_EXECUTABLE_SUFFIXES.map((suffix) => `${trimmed}${suffix}`)]
      : [trimmed];

  for (const candidate of lookupCandidates) {
    const located = locateWithSystem(candidate);
    if (located) {
      return located;
    }
  }
  return null;
}

export function commandExists(command: string): boolean {
  return resolveCommand(command) !== null;
}

export function shouldUseShellForCommand(command: string): boolean {
  if (!isWindows()) {
    return false;
  }

  const lower = command.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return true;
  }

  // On Windows, bare command names usually resolve to .cmd shims.
  return !looksLikePath(command);
}
