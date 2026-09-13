import { anthropicParser } from "./anthropic";
import { hetznerParser } from "./hetzner";
import { openAiParser } from "./openai";
import { supabaseParser } from "./supabase";
import { vercelParser } from "./vercel";

export const supplierParsers = [
  openAiParser,
  anthropicParser,
  vercelParser,
  hetznerParser,
  supabaseParser,
];
