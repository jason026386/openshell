import type {
  LlmProvider,
  ProviderStreamCallbacks,
} from "../providers/provider-registry.js";
import { providerNames } from "../types.js";
import type { ProviderName } from "../types.js";
import { SessionStore } from "./session-store.js";

export class ChatService {
  private readonly chatLocks = new Map<string, Promise<void>>();

  public constructor(
    private readonly sessions: SessionStore,
    private readonly providers: Map<ProviderName, LlmProvider>,
    private readonly systemPrompt?: string,
  ) {}

  public getAvailableProviders(): ProviderName[] {
    return [...this.providers.keys()];
  }

  public getProvider(chatKey: string): ProviderName {
    return this.sessions.getProvider(chatKey);
  }

  public setProvider(chatKey: string, provider: string): ProviderName {
    if (!providerNames.includes(provider as ProviderName)) {
      throw new Error("Supported providers: codex, claude.");
    }

    const typedProvider = provider as ProviderName;
    if (!this.providers.has(typedProvider)) {
      throw new Error(`Provider '${typedProvider}' is not configured.`);
    }

    this.sessions.setProvider(chatKey, typedProvider);
    return typedProvider;
  }

  public reset(chatKey: string): void {
    this.sessions.reset(chatKey);
  }

  public getModel(
    chatKey: string,
    provider: ProviderName,
  ): string | undefined {
    return this.sessions.getModel(chatKey, provider);
  }

  public setModel(
    chatKey: string,
    provider: ProviderName,
    model: string | undefined,
  ): void {
    if (!this.providers.has(provider)) {
      throw new Error(`Provider '${provider}' is not configured.`);
    }
    this.sessions.setModel(chatKey, provider, model);
  }

  public getReasoningEffort(
    chatKey: string,
    provider: ProviderName,
  ): string | undefined {
    return this.sessions.getReasoningEffort(chatKey, provider);
  }

  public setReasoningEffort(
    chatKey: string,
    provider: ProviderName,
    effort: string | undefined,
  ): void {
    if (!this.providers.has(provider)) {
      throw new Error(`Provider '${provider}' is not configured.`);
    }
    this.sessions.setReasoningEffort(chatKey, provider, effort);
  }

  public async askStream(
    chatKey: string,
    userText: string,
    callbacks: ProviderStreamCallbacks,
  ): Promise<{ provider: ProviderName; reply: string }> {
    return this.withChatLock(chatKey, async () => {
      let providerName = this.sessions.getProvider(chatKey);
      let provider = this.providers.get(providerName);

      if (!provider) {
        const fallback = this.getAvailableProviders()[0];
        if (!fallback) {
          throw new Error("No LLM providers are available.");
        }
        this.sessions.setProvider(chatKey, fallback);
        providerName = fallback;
        provider = this.providers.get(providerName);
      }

      if (!provider) {
        throw new Error(`Provider '${providerName}' is not available.`);
      }

      const prompt = this.sessions.buildPrompt(chatKey, userText, this.systemPrompt);
      const selectedModel = this.sessions.getModel(chatKey, providerName);
      const selectedReasoningEffort = this.sessions.getReasoningEffort(
        chatKey,
        providerName,
      );
      const reply = await provider.stream(prompt, callbacks, {
        model: selectedModel,
        reasoningEffort: selectedReasoningEffort,
      });
      this.sessions.appendExchange(chatKey, userText, reply);
      return { provider: providerName, reply };
    });
  }

  private async withChatLock<T>(
    chatKey: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.chatLocks.get(chatKey) ?? Promise.resolve();
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    this.chatLocks.set(chatKey, tail);

    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent?.();
      if (this.chatLocks.get(chatKey) === tail) {
        this.chatLocks.delete(chatKey);
      }
    }
  }
}
