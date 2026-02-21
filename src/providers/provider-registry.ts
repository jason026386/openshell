import type { AppConfig } from "../config.js";
import type { ConversationMessage, ProviderName } from "../types.js";
import { ClaudeCliProvider } from "./claude-cli-provider.js";
import { CodexCliProvider } from "./codex-cli-provider.js";
import { resolveCommand } from "./command-utils.js";

export interface ProviderStreamOptions {
  model?: string;
  reasoningEffort?: string;
}

export interface LlmProvider {
  stream(
    messages: ConversationMessage[],
    callbacks: ProviderStreamCallbacks,
    options?: ProviderStreamOptions,
  ): Promise<string>;
}

export interface ProviderStreamCallbacks {
  onText: (text: string) => Promise<void> | void;
  onStatus?: (status: string) => Promise<void> | void;
}

export function createProviderRegistry(
  config: AppConfig,
): Map<ProviderName, LlmProvider> {
  const providers = new Map<ProviderName, LlmProvider>();

  const codexCommand = resolveCommand(config.codex.command);
  if (codexCommand) {
    const bypass = true;
    providers.set(
      "codex",
      new CodexCliProvider(
        codexCommand,
        config.cliWorkdir,
        config.codex.model,
        bypass,
      ),
    );
    console.warn(
      "[openshell] WARNING: Codex will run without sandbox/approval. This is unsafe in untrusted environments.",
    );
  } else {
    console.warn(
      `[openshell] Codex CLI not found: '${config.codex.command}'. 'codex' provider disabled.`,
    );
  }

  const claudeCommand = resolveCommand(config.claude.command);
  if (claudeCommand) {
    const bypass = true;
    providers.set(
      "claude",
      new ClaudeCliProvider(
        claudeCommand,
        config.cliWorkdir,
        config.claude.model,
        bypass,
      ),
    );
    console.warn(
      "[openshell] WARNING: Claude will run without permission checks. This is unsafe in untrusted environments.",
    );
  } else {
    console.warn(
      `[openshell] Claude CLI not found: '${config.claude.command}'. 'claude' provider disabled.`,
    );
  }

  return providers;
}
