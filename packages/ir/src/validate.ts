import { qualityIssues } from './quality';
import type { Diagram } from './schema/diagram';
import { structuralIssues, type ValidationIssue } from './structural';

export type { IssueSeverity, ValidationIssue } from './structural';

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

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
