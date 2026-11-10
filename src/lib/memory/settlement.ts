import type { Outcome } from "@/types/domain";

export function closingSignal(outcomes: Outcome[]): {
  leader: Outcome;
  tiedLeaders: Outcome[];
} {
  if (outcomes.length === 0) {
    throw new RangeError("A closing signal requires at least one outcome.");
  }
  // Strict `>` retains the earliest market outcome as the representative when
  // closing prices tie. Representation never turns a tie into a followed signal.
  const leader = outcomes.reduce((current, outcome) =>
    outcome.price > current.price ? outcome : current,
  );
  return {
    leader,
    tiedLeaders: outcomes.filter((outcome) => outcome.price === leader.price),
  };
}

/** True only when the winner is strictly more expensive than every alternative. */
export function sponsorFollowedStrictHighest(
  outcomes: Outcome[],
  winningOutcomeId: string,
): boolean {
  const winner = outcomes.find((outcome) => outcome.id === winningOutcomeId);
  return Boolean(
    winner &&
    outcomes.every(
      (outcome) =>
        outcome.id === winningOutcomeId || winner.price > outcome.price,
    ),
  );
}
