export const providerNames = ["codex", "claude"] as const;

export type ProviderName = (typeof providerNames)[number];

export type MessageRole = "system" | "user" | "assistant";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

