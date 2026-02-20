import type { ConversationMessage } from "../types.js";
import type {
  ProviderStreamCallbacks,
  ProviderStreamOptions,
} from "./provider-registry.js";
import { renderCliPrompt } from "./render-cli-prompt.js";
import { runJsonlCli } from "./run-jsonl-cli.js";

interface ClaudeLine {
  type?: string;
  result?: string;
  is_error?: boolean;
  message?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  event?: {
    type?: string;
    delta?: {
      type?: string;
      text?: string;
    };
  };
}

function extractAssistantText(payload: ClaudeLine): string {
  return (
    payload.message?.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text?.trim())
      .filter((text): text is string => Boolean(text))
      .join("\n") ?? ""
  );
}

export class ClaudeCliProvider {
  public constructor(
    private readonly command: string,
    private readonly cwd: string,
    private readonly model?: string,
    private readonly dangerouslyBypassApprovalsAndSandbox = false,
  ) {}

  public async stream(
    messages: ConversationMessage[],
    callbacks: ProviderStreamCallbacks,
    options?: ProviderStreamOptions,
  ): Promise<string> {
    let reply = "";
    let finalResult = "";
    const model = options?.model?.trim() || this.model;

    const args = [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
    ];
    if (this.dangerouslyBypassApprovalsAndSandbox) {
      args.push("--dangerously-skip-permissions");
    }
    if (model) {
      args.push("--model", model);
    }

    const result = await runJsonlCli(
      this.command,
      args,
      this.cwd,
      renderCliPrompt(messages),
      {
        onLine: async (line) => {
          let payload: ClaudeLine;
          try {
            payload = JSON.parse(line) as ClaudeLine;
          } catch {
            return;
          }

          if (payload.type === "result") {
            if (payload.is_error) {
              throw new Error(payload.result || "claude CLI error");
            }
            if (typeof payload.result === "string") {
              finalResult = payload.result;
              await callbacks.onText(finalResult);
            }
            return;
          }

          if (payload.type === "assistant") {
            const assistantText = extractAssistantText(payload);
            if (assistantText) {
              reply = assistantText;
              await callbacks.onText(reply);
            }
            return;
          }

          if (
            payload.type === "stream_event" &&
            payload.event?.type === "content_block_delta" &&
            payload.event.delta?.type === "text_delta" &&
            typeof payload.event.delta.text === "string"
          ) {
            reply += payload.event.delta.text;
            await callbacks.onText(reply);
          }
        },
      },
    );

    if (result.code !== 0) {
      throw new Error(
        `claude CLI exited with code ${result.code}${result.stderrTail ? `: ${result.stderrTail}` : ""}`,
      );
    }

    const finalReply = (finalResult || reply).trim();
    if (!finalReply) {
      throw new Error("claude CLI 응답이 비어 있습니다.");
    }

    return finalReply;
  }
}
