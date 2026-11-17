import type { z } from 'zod';
import { claudeObject } from './claude.server';

// All structured AI runs on Claude with the server's ANTHROPIC_API_KEY. The old per-user key/model
// arguments are accepted and ignored so callers stay unchanged.
export async function structuredAI<T>(schema: z.ZodType<T>, instructions: string, prompt: string, _key?: string, _model?: string): Promise<T> {
  return claudeObject(schema, instructions, prompt);
}
