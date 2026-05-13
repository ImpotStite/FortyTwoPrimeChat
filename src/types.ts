type Role = "system" | "user" | "assistant";

export interface ImageAttachment {
  id: string;
  type: "image";
  /** data:image/...;base64,... */
  dataUrl: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Cost in USD (from OpenRouter when `usage.include = true`). */
  cost?: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  attachments?: ImageAttachment[];
  createdAt: number;
  edited?: boolean;
  /** Model used for this reply (may differ from the primary model if OpenRouter falls back). */
  model?: string;
  usage?: Usage;
  /** True when generation failed. */
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  /** Optional per-conversation model override. */
  model?: string;
  /** Optional custom system prompt for this chat. */
  systemPrompt?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
}

export type Theme = "dark" | "light";
