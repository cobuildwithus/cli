import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { CliDeps, FetchLike } from "./types.js";

interface OpenExternalCommand {
  cmd: string;
  args: string[];
  options: {
    stdio: "ignore";
    detached: true;
    windowsHide?: boolean;
  };
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

const nodeFetch: FetchLike = async (input, init) => {
  return fetch(input, init);
};

export function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function normalizeXdgOpenTarget(target: string): string {
  return target.startsWith("-") ? `./${target}` : target;
}

export function buildOpenExternalCommand(platform: NodeJS.Platform, url: string): OpenExternalCommand {
  if (platform === "darwin") {
    return { cmd: "open", args: ["--", url], options: { stdio: "ignore", detached: true } };
  }

  if (platform === "win32") {
    return {
      cmd: "explorer.exe",
      args: [url],
      options: {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      },
    };
  }

  const normalizedTarget = normalizeXdgOpenTarget(url);
  return {
    cmd: "xdg-open",
    args: [normalizedTarget],
    options: { stdio: "ignore", detached: true },
  };
}

/* c8 ignore start */
async function openExternal(url: string): Promise<boolean> {
  if (!isAllowedExternalUrl(url)) {
    return false;
  }

  const command = buildOpenExternalCommand(process.platform, url);

  return await new Promise((resolve) => {
    const child = spawn(command.cmd, command.args, command.options);
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
/* c8 ignore stop */

export const defaultDeps: CliDeps = {
  fs,
  homedir: () => os.homedir(),
  fetch: nodeFetch,
  randomUUID,
  openExternal,
  stdout: (message) => {
    console.log(message);
  },
  stderr: (message) => {
    console.error(message);
  },
  exit: (code) => process.exit(code),
};
