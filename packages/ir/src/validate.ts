import { z } from 'zod';
import { IdSchema } from './ids';
import { qualityIssues } from './quality';
import type { Diagram } from './schema/diagram';
import { structuralIssues, type ValidationIssue } from './structural';

export type { IssueSeverity, ValidationIssue } from './structural';

/** Wire form of a validation issue (spec 01 §6), shared with `@nivik/protocol`. */
export const ValidationIssueSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  ids: z.array(IdSchema),
  message: z.string(),
}) satisfies z.ZodType<ValidationIssue>;

export const ValidationResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(ValidationIssueSchema),
  warnings: z.array(ValidationIssueSchema),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/**
 * Pure validation of an in-memory diagram (spec 01 §6): structural errors block, quality warnings
 * inform. Works on unparsed objects too, so it can check the result of an in-memory Change Set.
 */
export function validateDiagram(d: Diagram): ValidationResult {
  const errors: ValidationIssue[] = structuralIssues(d).map(({ code, severity, ids, message }) => ({
    code,
    severity,
    ids,
    message,
  }));
  return { ok: errors.length === 0, errors, warnings: qualityIssues(d) };
}
