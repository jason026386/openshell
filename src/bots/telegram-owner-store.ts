import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

interface PersistedTelegramOwnerStoreV1 {
  version: 1;
  savedAt: string;
  ownerUserId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class TelegramOwnerStore {
  private ownerUserId?: string;

  public constructor(private readonly persistencePath: string) {
    this.loadFromDisk();
  }

  public getOwnerUserId(): string | undefined {
    return this.ownerUserId;
  }

  public setOwnerUserId(ownerUserId: string): void {
    const normalized = ownerUserId.trim();
    if (!normalized) {
      throw new Error("ownerUserId must not be empty.");
    }
    this.ownerUserId = normalized;
    this.persist();
  }

  private loadFromDisk(): void {
    if (!this.persistencePath || !existsSync(this.persistencePath)) {
      return;
    }

    try {
      const raw = JSON.parse(readFileSync(this.persistencePath, "utf8")) as unknown;
      if (!isRecord(raw) || raw.version !== 1 || typeof raw.ownerUserId !== "string") {
        console.warn(
          `[openshell] owner store format is invalid: ${this.persistencePath}`,
        );
        return;
      }
      const ownerUserId = raw.ownerUserId.trim();
      this.ownerUserId = ownerUserId ? ownerUserId : undefined;
    } catch (error) {
      console.warn(
        `[openshell] failed to load owner store: ${this.persistencePath}`,
        error,
      );
    }
  }

  private persist(): void {
    if (!this.persistencePath) {
      return;
    }

    try {
      if (!this.ownerUserId) {
        return;
      }
      const payload: PersistedTelegramOwnerStoreV1 = {
        version: 1,
        savedAt: new Date().toISOString(),
        ownerUserId: this.ownerUserId,
      };
      const dir = dirname(this.persistencePath);
      mkdirSync(dir, { recursive: true });
      const tempPath = `${this.persistencePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
      renameSync(tempPath, this.persistencePath);
    } catch (error) {
      console.warn(
        `[openshell] failed to persist owner store: ${this.persistencePath}`,
        error,
      );
    }
  }
}

