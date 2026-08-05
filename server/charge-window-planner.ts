/**
 * @file Charge window planner for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { LogLevel, vehicleLog } from "@shared/utils.js";
import { ChargeType } from "@shared/sc-types.js";
import type { ChargePlan } from "./gql/vehicle-type.js";

export type PriceSlot = Readonly<{ from: number; to: number; price: number }>;
export type ChargeWindow = { start: number; stop: number };
export type WindowAllocation = Readonly<{
  durationMs: number;
  chargeType: ChargeType;
  comment: string;
  level: number;
}>;
// A plan entry the planner produced: a ChargePlan that always has both bounds.
type PlanEntry = ChargePlan & { chargeStart: Date; chargeStop: Date };
type PlannedWindows = { windows: ChargeWindow[]; scheduledMs: number; deliveredMs: number };

export interface ChargeWindowPlannerContext {
  vehicleUUID: string;
  /** Ascending and non-overlapping; the planner reads them left to right without sorting. */
  priceSlots: ReadonlyArray<PriceSlot>;
  disallowGaps: boolean;
  warmupPenaltyMs: number;
}

// Hard cap: drop any slot above (maxPrice * SOFT_MAXPRICE_CAP_FACTOR).
const SOFT_MAXPRICE_CAP_FACTOR = 1.5;
// Price values in DB are stored as integer(price * 1e5) to keep precision.
const DB_PRICE_SCALE = 1e5;
const fmtDbPrice = (p: number): string => (p / DB_PRICE_SCALE).toFixed(5);

const YIELD_EVERY_MS = 5;
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Label the planner's selected windows with intent metadata.
 *
 * Allocations model delivered charging time, while selected windows also contain warmup
 * debt and kept-whole tariff intervals, so the windows can hold more time than the
 * allocations. The last allocation absorbs that excess, which keeps every selected
 * window covered by plan entries and never lets an entry extend into a gap between
 * windows.
 */
export function applyWindowAllocations(
  windows: ReadonlyArray<ChargeWindow>,
  allocations: ReadonlyArray<WindowAllocation>,
  hardStart: number
): { entries: PlanEntry[]; lastStop: number } {
  assert(allocations.length > 0);
  assert(allocations.every((a) => a.durationMs > 0));
  // Non-empty, ascending, non-overlapping and never before hardStart, so entries come out in
  // order and the last one ends latest.
  assert(windows.every((w, i) => w.stop > w.start && w.start >= (i === 0 ? hardStart : windows[i - 1].stop)));
  const remainders = allocations.map((a) => a.durationMs);
  remainders[remainders.length - 1] = Number.POSITIVE_INFINITY;

  const entries: PlanEntry[] = [];
  let i = 0;
  for (const w of windows) {
    let cursor = w.start;
    while (cursor < w.stop && i < allocations.length) {
      const take = Math.min(w.stop - cursor, remainders[i]);
      entries.push({
        chargeStart: new Date(cursor),
        chargeStop: new Date(cursor + take),
        level: allocations[i].level,
        chargeType: allocations[i].chargeType,
        comment: allocations[i].comment,
      });
      cursor += take;
      remainders[i] -= take;
      if (remainders[i] <= 0) i++;
    }
  }
  return {
    entries,
    lastStop: entries.length > 0 ? entries[entries.length - 1].chargeStop.getTime() : hardStart,
  };
}

/**
 * Scheduling specification
 *
 * The planner works on whole tariff intervals only. Each candidate interval is the raw price
 * interval clipped to the active planning window [hardStart, until), both finite; the caller
 * collapses its own deadline and hard-end bounds into `until`.
 * The optimizer never invents finer precision than the tariff feed provides and never trims a
 * selected interval internally. If a 30-minute interval is selected, the plan keeps the full
 * 30 minutes. This intentionally favors tariff fidelity over exact target timestamps.
 *
 * Optimization model
 *
 * 1. Build an ordered list of candidate tariff intervals.
 * 2. Walk the list from left to right and, for every interval, decide whether to take it or skip it.
 * 3. Track an explicit charger phase at the start of each interval:
 *    - idle:     no charging has been scheduled yet.
 *    - charging: charging is active at the interval start and can continue without a restart.
 *    - stopped:  charging has been stopped earlier, so taking a later interval is a restart.
 * 4. A restart is allowed according to split mode:
 *    - never:  restart is forbidden after charging stops, so at most one contiguous window.
 *    - auto:   restart is allowed and pays a warmup penalty.
 *    - always: restart is allowed with zero penalty.
 * 5. The warmup penalty is modeled as lost effective charging time after a restart. When a
 *    stopped plan restarts, it accrues warmupDebtMs. Selected intervals first pay down that
 *    debt, and only the remaining time in those intervals counts as delivered charging.
 *    If the vehicle is already charging and the first candidate interval starts later than
 *    hardStart, the initial state is treated as stopped so a later take incurs warmup debt.
 *
 * maxPrice semantics
 *
 * - Intervals above maxPrice * SOFT_MAXPRICE_CAP_FACTOR are dropped entirely.
 * - For the remaining intervals, the optimizer minimizes actual energy cost.
 * - A finished plan is feasible only if its average raw interval price is <= maxPrice:
 *     totalChargeCost <= maxPrice * totalScheduledDuration
 * - If no full-duration feasible plan exists, best effort means "schedule the longest feasible
 *   duration" rather than returning an invalid over-average plan.
 *
 * Objective and tie-breaks
 *
 * - Primary:   maximize delivered charging duration up to the requested target.
 * - Secondary: minimize total energy cost of the selected tariff intervals.
 * - Tertiary:  minimize number of charging windows.
 * - Last:      prefer an earlier first charging start.
 *
 * Reconstruction
 *
 * Chosen intervals are merged back into contiguous windows after optimization. The rest of the
 * system still consumes { start, stop } windows. scheduledMs is the total selected interval
 * time; deliveredMs is scheduledMs minus the warmup debt paid, capped at the requested target.
 */
export async function planChargeWindows(
  ctx: ChargeWindowPlannerContext,
  args: {
    timeNeededMs: number;
    hardStart: number;
    until: number;
    maxPrice: number | undefined;
    scheduleTag: string;
    isCharging: boolean;
  }
): Promise<PlannedWindows> {
  const { vehicleUUID, priceSlots, disallowGaps, warmupPenaltyMs } = ctx;
  const { timeNeededMs, hardStart, until, maxPrice, scheduleTag, isCharging } = args;
  assert(Number.isFinite(hardStart) && Number.isFinite(until));

  type AtomicStep = Readonly<{ start: number; stop: number; duration: number; price: number; chargeCostMs: number }>;
  type PlanPhase = "idle" | "charging" | "stopped";
  type PlanNode = Readonly<{
    prev: number | null;
    step: AtomicStep | null;
    phase: PlanPhase;
    deliveredMs: number;
    scheduledMs: number;
    warmupDebtMs: number;
    chargeCostMs: number;
    windows: number;
    firstStartMs: number;
  }>;

  const scheduled: PlannedWindows = { windows: [], scheduledMs: 0, deliveredMs: 0 };
  const hardCapPrice = maxPrice === undefined ? undefined : maxPrice * SOFT_MAXPRICE_CAP_FACTOR;
  const atomicSteps: ReadonlyArray<AtomicStep> = priceSlots
    .flatMap((slot: PriceSlot): AtomicStep[] => {
      const start = Math.max(slot.from, hardStart);
      const stop = Math.min(slot.to, until);
      if (stop <= start) return [];
      if (hardCapPrice !== undefined && slot.price > hardCapPrice) return [];
      const duration = stop - start;
      return [{ start, stop, duration, price: slot.price, chargeCostMs: slot.price * duration }];
    });

  if (atomicSteps.length === 0) {
    vehicleLog(LogLevel.Trace, vehicleUUID, `scheduleWindows(${scheduleTag}): no segments (no price data?)`);
    return scheduled;
  }
  // The DP walks the steps left to right: contiguity, initial phase and window merging all read
  // adjacency straight off the array order, so unsorted priceSlots are a developer error.
  assert(atomicSteps.every((step, i) => i === 0 || step.start >= atomicSteps[i - 1].stop));
  const totalAvailableMs = atomicSteps.reduce((sum, step) => sum + step.duration, 0);

  const targetMaxMs = Math.max(0, Math.min(timeNeededMs, totalAvailableMs));
  if (targetMaxMs < 1) {
    vehicleLog(LogLevel.Trace, vehicleUUID, `scheduleWindows(${scheduleTag}): nothing to schedule (need=${Math.round(timeNeededMs / 60e3)}min avail=${Math.round(totalAvailableMs / 60e3)}min)`);
    return scheduled;
  }
  vehicleLog(
    LogLevel.Trace,
    vehicleUUID,
    `scheduleWindows(${scheduleTag}): need=${Math.round(timeNeededMs / 60e3)}min targetMax=${Math.round(targetMaxMs / 60e3)}min ` +
    `until=${new Date(until).toISOString()} intervals=${atomicSteps.length} avail=${Math.round(totalAvailableMs / 60e3)}min ` +
    `maxPrice=${maxPrice === undefined ? "none" : fmtDbPrice(maxPrice)}`
  );

  const phases: ReadonlyArray<PlanPhase> = ["idle", "charging", "stopped"];
  const makePhaseMaps = (): Record<PlanPhase, Map<string, number>> => ({
    idle: new Map<string, number>(),
    charging: new Map<string, number>(),
    stopped: new Map<string, number>(),
  });
  const nodes: PlanNode[] = [];
  // recordNode caps deliveredMs at targetMaxMs before storing, and nodes sharing a state key are
  // already equal on deliveredMs/scheduledMs/warmupDebtMs, so the first comparison is a tie for
  // them and this ranks both the pruning and the final-selection case.
  const compareNodes = (left: PlanNode, right: PlanNode): number => {
    if (left.deliveredMs !== right.deliveredMs) return left.deliveredMs - right.deliveredMs;
    if (left.chargeCostMs !== right.chargeCostMs) return right.chargeCostMs - left.chargeCostMs;
    if (left.windows !== right.windows) return right.windows - left.windows;
    return right.firstStartMs - left.firstStartMs;
  };
  const recordNode = (
    states: Record<PlanPhase, Map<string, number>>,
    node: PlanNode
  ) => {
    const stateMap = states[node.phase];
    assert(node.warmupDebtMs >= 0);
    assert(node.phase === "charging" || node.warmupDebtMs === 0);
    const deliveredMs = Math.min(node.deliveredMs, targetMaxMs);
    const normalizedNode = deliveredMs === node.deliveredMs ? node : { ...node, deliveredMs };
    const stateKey = `${normalizedNode.deliveredMs}:${normalizedNode.scheduledMs}:${normalizedNode.warmupDebtMs}`;
    const existingIndex = stateMap.get(stateKey);
    if (existingIndex !== undefined && compareNodes(nodes[existingIndex], normalizedNode) >= 0) return;
    stateMap.set(stateKey, nodes.push(normalizedNode) - 1);
  };

  const initialPhase: PlanPhase = isCharging
    ? atomicSteps[0].start === hardStart ? "charging" : "stopped"
    : "idle";
  let states = makePhaseMaps();
  recordNode(states, {
    prev: null,
    step: null,
    phase: initialPhase,
    deliveredMs: 0,
    scheduledMs: 0,
    warmupDebtMs: 0,
    chargeCostMs: 0,
    windows: 0,
    firstStartMs: Number.POSITIVE_INFINITY,
  });

  let yieldDeadline = performance.now() + YIELD_EVERY_MS;
  for (let stepIndex = 0; stepIndex < atomicSteps.length; stepIndex++) {
    const step = atomicSteps[stepIndex];
    const nextStates = makePhaseMaps();
    for (const phase of phases) {
      for (const stateIndex of states[phase].values()) {
        const state = nodes[stateIndex];
        const skipPhase: PlanPhase = phase === "charging" ? "stopped" : phase;
        recordNode(nextStates, {
          prev: stateIndex,
          step: null,
          phase: skipPhase,
          deliveredMs: state.deliveredMs,
          scheduledMs: state.scheduledMs,
          warmupDebtMs: 0,
          chargeCostMs: state.chargeCostMs,
          windows: state.windows,
          firstStartMs: state.firstStartMs,
        });

        if (state.deliveredMs >= targetMaxMs) continue;
        const restart = phase === "stopped";
        if (restart && disallowGaps) continue;
        const startsNewWindow = state.scheduledMs === 0 || phase !== "charging";
        const warmupDebtMs = restart ? warmupPenaltyMs : state.warmupDebtMs;
        const consumedWarmupMs = Math.min(step.duration, warmupDebtMs);
        const deliveredIncrementMs = step.duration - consumedWarmupMs;
        const remainingWarmupDebtMs = warmupDebtMs - consumedWarmupMs;
        const nextPhase: PlanPhase = stepIndex + 1 < atomicSteps.length && atomicSteps[stepIndex + 1].start === step.stop
          ? "charging"
          : "stopped";
        recordNode(nextStates, {
          prev: stateIndex,
          step,
          phase: nextPhase,
          deliveredMs: state.deliveredMs + deliveredIncrementMs,
          scheduledMs: state.scheduledMs + step.duration,
          warmupDebtMs: nextPhase === "charging" ? remainingWarmupDebtMs : 0,
          chargeCostMs: state.chargeCostMs + step.chargeCostMs,
          windows: state.windows + (startsNewWindow ? 1 : 0),
          firstStartMs: Math.min(state.firstStartMs, step.start),
        });
      }
    }
    states = nextStates;
    // Keep the worst uninterrupted block near YIELD_EVERY_MS; this process also serves GraphQL.
    // A step count cannot do that: the cost of one step scales with the frontier.
    if (performance.now() >= yieldDeadline) {
      await yieldToEventLoop();
      yieldDeadline = performance.now() + YIELD_EVERY_MS;
    }
  }

  const isFeasibleAverage = (node: PlanNode): boolean => {
    return maxPrice === undefined
      || node.scheduledMs === 0
      || node.chargeCostMs <= maxPrice * node.scheduledMs;
  };

  let bestIndex: number | undefined;
  for (const phase of phases) {
    for (const stateIndex of states[phase].values()) {
      const node = nodes[stateIndex];
      if (!isFeasibleAverage(node)) continue;
      if (bestIndex === undefined || compareNodes(node, nodes[bestIndex]) > 0) {
        bestIndex = stateIndex;
      }
    }
  }

  // The all-skip chain always reaches the final frontier with scheduledMs === 0, which
  // isFeasibleAverage accepts, so there is always a best node -- it just may deliver nothing.
  assert(bestIndex !== undefined);
  const best = nodes[bestIndex];
  if (best.deliveredMs <= 0) {
    vehicleLog(LogLevel.Trace, vehicleUUID, `scheduleWindows(${scheduleTag}): no feasible intervals after constraints`);
    return scheduled;
  }

  const selectedSteps: AtomicStep[] = [];
  for (let nodeIndex: number | null = bestIndex; nodeIndex !== null; nodeIndex = nodes[nodeIndex].prev) {
    const step = nodes[nodeIndex].step;
    if (step) selectedSteps.push(step);
  }
  selectedSteps.reverse();

  const reconstructedWindows: ChargeWindow[] = [];
  for (const step of selectedSteps) {
    const last = reconstructedWindows[reconstructedWindows.length - 1];
    if (last && last.stop === step.start) {
      last.stop = step.stop;
    } else {
      reconstructedWindows.push({ start: step.start, stop: step.stop });
    }
  }

  vehicleLog(LogLevel.Trace, vehicleUUID,
    `scheduleWindows(${scheduleTag}): delivered=${Math.round(best.deliveredMs / 60e3)}/${Math.round(targetMaxMs / 60e3)}min ` +
    `avgPrice=${fmtDbPrice(best.chargeCostMs / best.scheduledMs)} warmupDebt=${Math.round(best.warmupDebtMs / 60e3)}min ` +
    `windows=${reconstructedWindows.map((w) => `${new Date(w.start).toISOString()}..${new Date(w.stop).toISOString()}`).join(", ")}`
  );
  return { windows: reconstructedWindows, scheduledMs: best.scheduledMs, deliveredMs: best.deliveredMs };
}
