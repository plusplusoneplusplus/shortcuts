import { z } from 'zod';

// Base string schemas
export const nonEmptyString = z.string().min(1, 'Must not be empty');
export const portNumber = z.number().int().min(1).max(65535);

// File path schemas
export const filePath = z.string().min(1);
export const absolutePath = z.string().refine(
  (path) => path.startsWith('/') || /^[A-Za-z]:/.test(path),
  'Must be an absolute path'
);

// Helper: Create schema with optional defaults
export function withDefaults<T extends z.ZodTypeAny>(
  schema: T,
  defaults: z.infer<T>
): z.ZodDefault<T> {
  return schema.default(defaults);
}
