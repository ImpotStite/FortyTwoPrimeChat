type Role = "system" | "user" | "assistant";

export interface ImageAttachment {
  id: string;
  type: "image";
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
  cost?: number;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  attachments?: ImageAttachment[];
  createdAt: number;
  edited?: boolean;
  model?: string;
  usage?: Usage;
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  model?: string;
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
