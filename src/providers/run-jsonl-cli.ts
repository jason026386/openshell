import { spawn } from "node:child_process";

export interface JsonlCallbacks {
  onLine: (line: string) => Promise<void> | void;
  onStderr?: (chunk: string) => Promise<void> | void;
}

interface JsonlResult {
  code: number;
  signal: NodeJS.Signals | null;
  stderrTail: string;
}

function tailText(text: string, size: number): string {
  return text.length > size ? text.slice(text.length - size) : text;
}

export async function runJsonlCli(
  command: string,
  args: string[],
  cwd: string,
  stdinText: string,
  callbacks: JsonlCallbacks,
): Promise<JsonlResult> {
  return new Promise<JsonlResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    let stdoutBuffer = "";
    let callbackQueue = Promise.resolve();
    let failed = false;

    const queue = (fn: () => Promise<void> | void): void => {
      callbackQueue = callbackQueue.then(async () => {
        if (failed) {
          return;
        }
        await fn();
      });
      callbackQueue.catch((error: unknown) => {
        failed = true;
        child.kill("SIGTERM");
        reject(error);
      });
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          queue(() => callbacks.onLine(line));
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr = tailText(stderr + text, 12_000);
      if (callbacks.onStderr) {
        queue(() => callbacks.onStderr?.(text));
      }
    });

    child.on("error", (error) => {
      failed = true;
      reject(error);
    });

    child.on("close", async (code, signal) => {
      if (failed) {
        return;
      }

      const remain = stdoutBuffer.trim();
      if (remain) {
        queue(() => callbacks.onLine(remain));
      }

      try {
        await callbackQueue;
        resolve({
          code: code ?? 1,
          signal,
          stderrTail: stderr.trim(),
        });
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

