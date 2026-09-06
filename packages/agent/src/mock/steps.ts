const MAX_STEPS = 8;
const MAX_LABEL = 48;
const SEPARATORS = /\s*(?:→|->|=>|\n|;|\bthen\b)\s*/i;

/** Turns "A → B -> C" (or one step per line) into node labels; a plain sentence is one node. */
export function splitSteps(prompt: string): string[] {
  const steps = prompt
    .split(SEPARATORS)
    .map((step) => step.trim().replace(/[.。]+$/, ''))
    .filter((step) => step.length > 0)
    .slice(0, MAX_STEPS)
    .map((step) => (step.length > MAX_LABEL ? `${step.slice(0, MAX_LABEL - 1)}…` : step));
  return steps;
}
