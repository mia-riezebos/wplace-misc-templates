export type HqChargeCheckpoint = {
  exhausted: boolean;
  nextDispatchBudget: number;
};

export function resolveHqChargeCheckpoint(reportedCharges: number): HqChargeCheckpoint {
  const nextDispatchBudget = Number.isFinite(reportedCharges)
    ? Math.max(0, Math.floor(reportedCharges))
    : 0;
  return {
    exhausted: nextDispatchBudget === 0,
    nextDispatchBudget,
  };
}
