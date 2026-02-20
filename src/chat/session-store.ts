import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { providerNames } from "../types.js";
import type { ConversationMessage, ProviderName } from "../types.js";

interface ChatSession {
  provider: ProviderName;
  history: ConversationMessage[];
  modelOverrides: Partial<Record<ProviderName, string>>;
  reasoningEffortOverrides: Partial<Record<ProviderName, string>>;
}

interface PersistedSessionStoreV1 {
  version: 1;
  savedAt: string;
  sessions: Record<string, ChatSession>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProvider(value: unknown, fallback: ProviderName): ProviderName {
  if (typeof value === "string" && providerNames.includes(value as ProviderName)) {
    return value as ProviderName;
  }
  return fallback;
}

function normalizeOverrides(
  input: unknown,
): Partial<Record<ProviderName, string>> {
  if (!isRecord(input)) {
    return {};
  }

  const output: Partial<Record<ProviderName, string>> = {};
  for (const provider of providerNames) {
    const value = input[provider];
    if (typeof value === "string" && value.trim()) {
      output[provider] = value.trim();
    }
  }
  return output;
}

function normalizeHistory(input: unknown): ConversationMessage[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const history: ConversationMessage[] = [];
  for (const item of input) {
    if (!isRecord(item)) {
      continue;
    }
    const role = item.role;
    const content = item.content;
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.length > 0
    ) {
      history.push({ role, content });
    }
  }
  return history;
}

export class SessionStore {
  private readonly sessions = new Map<string, ChatSession>();
  private readonly persistencePath?: string;

  public constructor(
    private readonly defaultProvider: ProviderName,
    private readonly maxHistory: number,
    persistencePath?: string,
  ) {
    this.persistencePath = persistencePath?.trim() || undefined;
    this.loadFromDisk();
  }

  public getSessionCount(): number {
    return this.sessions.size;
  }

  public getPersistencePath(): string | undefined {
    return this.persistencePath;
  }

  public getProvider(chatKey: string): ProviderName {
    return this.getOrCreate(chatKey).provider;
  }

  public setProvider(chatKey: string, provider: ProviderName): void {
    const session = this.getOrCreate(chatKey);
    session.provider = provider;
    this.persist();
  }

  public reset(chatKey: string): void {
    this.sessions.delete(chatKey);
    this.persist();
  }

  public getModel(chatKey: string, provider: ProviderName): string | undefined {
    return this.getOrCreate(chatKey).modelOverrides[provider];
  }

  public setModel(
    chatKey: string,
    provider: ProviderName,
    model: string | undefined,
  ): void {
    const session = this.getOrCreate(chatKey);
    if (!model?.trim()) {
      delete session.modelOverrides[provider];
      this.persist();
      return;
    }
    session.modelOverrides[provider] = model.trim();
    this.persist();
  }

  public getReasoningEffort(
    chatKey: string,
    provider: ProviderName,
  ): string | undefined {
    return this.getOrCreate(chatKey).reasoningEffortOverrides[provider];
  }

  public setReasoningEffort(
    chatKey: string,
    provider: ProviderName,
    effort: string | undefined,
  ): void {
    const session = this.getOrCreate(chatKey);
    if (!effort?.trim()) {
      delete session.reasoningEffortOverrides[provider];
      this.persist();
      return;
    }
    session.reasoningEffortOverrides[provider] = effort.trim();
    this.persist();
  }

  public buildPrompt(
    chatKey: string,
    userText: string,
    systemPrompt?: string,
  ): ConversationMessage[] {
    const session = this.getOrCreate(chatKey);
    const messages = systemPrompt
      ? [{ role: "system", content: systemPrompt } as ConversationMessage]
      : [];

    messages.push(...session.history);
    messages.push({ role: "user", content: userText });
    return messages;
  }

  public appendExchange(
    chatKey: string,
    userText: string,
    assistantText: string,
  ): void {
    const session = this.getOrCreate(chatKey);
    session.history.push({ role: "user", content: userText });
    session.history.push({ role: "assistant", content: assistantText });
    if (session.history.length > this.maxHistory) {
      let trimmed = session.history.slice(-this.maxHistory);
      if (trimmed[0]?.role === "assistant") {
        trimmed = trimmed.slice(1);
      }
      session.history = trimmed;
    }
    this.persist();
  }

  private getOrCreate(chatKey: string): ChatSession {
    const existing = this.sessions.get(chatKey);
    if (existing) {
      return existing;
    }

    const session: ChatSession = {
      provider: this.defaultProvider,
      history: [],
      modelOverrides: {},
      reasoningEffortOverrides: {},
    };
    this.sessions.set(chatKey, session);
    return session;
  }

  private loadFromDisk(): void {
    if (!this.persistencePath || !existsSync(this.persistencePath)) {
      return;
    }

    try {
      const raw = JSON.parse(
        readFileSync(this.persistencePath, "utf8"),
      ) as unknown;
      if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.sessions)) {
        console.warn(
          `[openshell] session store format is invalid: ${this.persistencePath}`,
        );
        return;
      }

      for (const [chatKey, value] of Object.entries(raw.sessions)) {
        if (!isRecord(value)) {
          continue;
        }

        const session: ChatSession = {
          provider: normalizeProvider(value.provider, this.defaultProvider),
          history: this.trimHistory(normalizeHistory(value.history)),
          modelOverrides: normalizeOverrides(value.modelOverrides),
          reasoningEffortOverrides: normalizeOverrides(
            value.reasoningEffortOverrides,
          ),
        };
        this.sessions.set(chatKey, session);
      }
    } catch (error) {
      console.warn(
        `[openshell] failed to load session store: ${this.persistencePath}`,
        error,
      );
    }
  }

  private persist(): void {
    if (!this.persistencePath) {
      return;
    }

    try {
      const payload: PersistedSessionStoreV1 = {
        version: 1,
        savedAt: new Date().toISOString(),
        sessions: Object.fromEntries(this.sessions),
      };
      const dir = dirname(this.persistencePath);
      mkdirSync(dir, { recursive: true });
      const tempPath = `${this.persistencePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
      renameSync(tempPath, this.persistencePath);
    } catch (error) {
      console.warn(
        `[openshell] failed to persist session store: ${this.persistencePath}`,
        error,
      );
    }
  }

  private trimHistory(history: ConversationMessage[]): ConversationMessage[] {
    if (history.length <= this.maxHistory) {
      return history;
    }
    let trimmed = history.slice(-this.maxHistory);
    if (trimmed[0]?.role === "assistant") {
      trimmed = trimmed.slice(1);
    }
    return trimmed;
  }
}
