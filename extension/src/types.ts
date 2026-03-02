export type Provider = 'claude' | 'openai' | 'gemini';

export interface Config {
  provider: Provider;
  apiKey: string;
  model: string;
  autoLookup: boolean;
  contextMaxLength: number;
}

export interface LookupPayload {
  text: string;
  context: string;
  rect: { top: number; left: number; bottom: number; width: number };
}

export interface LookupResult {
  short_def: string;
  contextual_explain: string;
  example_use: string;
}

export interface LookupError {
  error: string;
}

export type LookupResponse = LookupResult | LookupError;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatResponse = { reply: string } | { error: string };

export type Message =
  | { type: 'lookup'; payload: LookupPayload }
  | { type: 'clear_cache' }
  | { type: 'chat'; payload: { messages: ChatMessage[] } };

export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
};

export const DEFAULT_CONFIG: Config = {
  provider: 'claude',
  apiKey: '',
  model: DEFAULT_MODELS.claude,
  autoLookup: true,
  contextMaxLength: 600,
};
