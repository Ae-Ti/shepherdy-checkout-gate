// The verdict is plain rule code. No AI output can change it.
//   any blocked check            -> BLOCKED       (exit 1)
//   anything not proven (skipped
//   or inconclusive)             -> INCONCLUSIVE  (exit 2)
//   every check passed           -> READY         (exit 0)
export function decide(checks) {
  if (checks.some((c) => c.status === "blocked")) return "BLOCKED";
  if (checks.some((c) => c.status !== "pass")) return "INCONCLUSIVE";
  return "READY";
}

export const EXIT_CODE = { READY: 0, BLOCKED: 1, INCONCLUSIVE: 2 };
