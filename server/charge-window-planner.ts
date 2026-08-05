/**
 * @file Charge window planner for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { LogLevel, vehicleLog } from "@shared/utils.js";
import { ChargeType } from "@shared/sc-types.js";

export type PriceSlot = Readonly<{ from: number; to: number; price: number }>;
export type ChargeWindow = { start: number; stop: number };
export type WindowAllocation = Readonly<{
  durationMs: number;
  chargeType: ChargeType;
  comment: string;
  level: number;
}>;
export type PlanEntry = {
  chargeStart: Date;
  chargeStop: Date;
  level: number;
  chargeType: ChargeType;
  comment: string;
};
export type PlannedWindows = { windows: ChargeWindow[]; scheduledMs: number; deliveredMs: number };

export interface ChargeWindowPlannerContext {
  vehicleUUID: string;
  priceSlots: ReadonlyArray<PriceSlot>;
  disallowGaps: boolean;
  warmupPenaltyMs: number;
}

// Hard cap: drop any slot above (maxPrice * SOFT_MAXPRICE_CAP_FACTOR).
export const SOFT_MAXPRICE_CAP_FACTOR = 1.5;
// Price values in DB are stored as integer(price * 1e5) to keep precision.
const DB_PRICE_SCALE = 1e5;
const fmtDbPrice = (p: number): string => (p / DB_PRICE_SCALE).toFixed(5);

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
  const sorted = windows.slice().sort((a, b) => a.start - b.start);
  const totalWindowMs = sorted.reduce((sum, w) => sum + (w.stop - w.start), 0);
  const allocatedMs = allocations.reduce((sum, a) => sum + a.durationMs, 0);
  const remainders = allocations.map((a) => a.durationMs);
  remainders[remainders.length - 1] += Math.max(0, totalWindowMs - allocatedMs);

  const entries: PlanEntry[] = [];
  let i = 0;
  for (const w of sorted) {
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
  let lastStop = hardStart;
  for (const entry of entries) {
    const stop = entry.chargeStop.getTime();
    if (stop > lastStop) lastStop = stop;
  }
  return { entries, lastStop };
}

/**
 * Scheduling specification
 *
 * The planner works on whole tariff intervals only. Each candidate interval is the raw price
 * interval clipped to the active planning window [hardStart, min(beforeTimestampMs, hardEnd)).
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
    beforeTimestampMs: number;
    hardStart: number;
    hardEnd: number;
    maxPrice: number | undefined;
    scheduleTag: string;
    isCharging: boolean;
  }
): Promise<PlannedWindows> {
  const { vehicleUUID, priceSlots, disallowGaps, warmupPenaltyMs } = ctx;
  const { timeNeededMs, beforeTimestampMs, hardStart, hardEnd, maxPrice, scheduleTag, isCharging } = args;

  type AtomicStep = Readonly<{ start: number; stop: number; duration: number; price: number; chargeCostMs: number }>;
  type PlanPhase = "idle" | "charging" | "stopped";
  type PlanAction = "seed" | "skip" | "take";
  type PlanNode = Readonly<{
    prev: number | null;
    action: PlanAction;
    stepIndex: number | null;
    phase: PlanPhase;
    deliveredMs: number;
    scheduledMs: number;
    warmupDebtMs: number;
    chargeCostMs: number;
    windows: number;
    firstStartMs?: number;
  }>;

  const scheduled: PlannedWindows = { windows: [], scheduledMs: 0, deliveredMs: 0 };
  const hardCapPrice = maxPrice === undefined ? undefined : maxPrice * SOFT_MAXPRICE_CAP_FACTOR;
  const atomicSteps: ReadonlyArray<AtomicStep> = priceSlots
    .flatMap((slot: PriceSlot): AtomicStep[] => {
      const start = Math.max(slot.from, hardStart);
      const stop = Math.min(slot.to, beforeTimestampMs, hardEnd);
      if (stop <= start) return [];
      if (hardCapPrice !== undefined && slot.price > hardCapPrice) return [];
      const duration = stop - start;
      return [{ start, stop, duration, price: slot.price, chargeCostMs: slot.price * duration }];
    })
    .sort((a, b) => a.start - b.start);

  if (atomicSteps.length === 0) {
    vehicleLog(LogLevel.Trace, vehicleUUID, `scheduleWindows(${scheduleTag}): no segments (no price data?)`);
    return scheduled;
  }
  let totalAvailableMs = 0;
  let minIntervalMs = Number.POSITIVE_INFINITY;
  for (const step of atomicSteps) {
    totalAvailableMs += step.duration;
    if (step.duration < minIntervalMs) minIntervalMs = step.duration;
  }

  const targetMaxMs = Math.max(0, Math.min(timeNeededMs, totalAvailableMs));
  if (targetMaxMs < 1) {
    vehicleLog(LogLevel.Trace, vehicleUUID, `scheduleWindows(${scheduleTag}): nothing to schedule (need=${Math.round(timeNeededMs / 60e3)}min avail=${Math.round(totalAvailableMs / 60e3)}min)`);
    return scheduled;
  }
  vehicleLog(
    LogLevel.Trace,
    vehicleUUID,
    `scheduleWindows(${scheduleTag}): need=${Math.round(timeNeededMs / 60e3)}min targetMax=${Math.round(targetMaxMs / 60e3)}min before=${new Date(beforeTimestampMs).toISOString()} ` +
    `intervals=${atomicSteps.length} avail=${Math.round(totalAvailableMs / 60e3)}min minQuantum=${Math.round(minIntervalMs / 60e3)}min ` +
    `maxPrice=${maxPrice === undefined ? "none" : fmtDbPrice(maxPrice)} capFactor=${SOFT_MAXPRICE_CAP_FACTOR}`
  );
  vehicleLog(
    LogLevel.Trace,
    vehicleUUID,
    `scheduleWindows(${scheduleTag}): intervalPreview=${atomicSteps.slice(0, 8).map((step) =>
      `${new Date(step.start).toISOString()}..${new Date(step.stop).toISOString()}@${fmtDbPrice(step.price)}`
    ).join(", ")}${atomicSteps.length > 8 ? ", ..." : ""}`
  );

  const phases: ReadonlyArray<PlanPhase> = ["idle", "charging", "stopped"];
  const makePhaseMaps = (): Record<PlanPhase, Map<string, number>> => ({
    idle: new Map<string, number>(),
    charging: new Map<string, number>(),
    stopped: new Map<string, number>(),
  });
  const nodes: PlanNode[] = [];
  const firstStartForRanking = (node: PlanNode): number => node.firstStartMs ?? Number.POSITIVE_INFINITY;
  let nodesRecorded = 0;
  let nodesPrunedDominated = 0;
  let nodesPrunedReplaced = 0;
  const compareContinuationNodes = (left: PlanNode, right: PlanNode): number => {
    assert(left.phase === right.phase);
    assert(left.deliveredMs === right.deliveredMs);
    assert(left.scheduledMs === right.scheduledMs);
    assert(left.warmupDebtMs === right.warmupDebtMs);
    if (left.chargeCostMs !== right.chargeCostMs) return right.chargeCostMs - left.chargeCostMs;
    if (left.windows !== right.windows) return right.windows - left.windows;
    return firstStartForRanking(right) - firstStartForRanking(left);
  };
  const compareFinalNodes = (left: PlanNode, right: PlanNode): number => {
    const leftDelivered = Math.min(left.deliveredMs, targetMaxMs);
    const rightDelivered = Math.min(right.deliveredMs, targetMaxMs);
    if (leftDelivered !== rightDelivered) return leftDelivered - rightDelivered;
    if (left.chargeCostMs !== right.chargeCostMs) return right.chargeCostMs - left.chargeCostMs;
    if (left.windows !== right.windows) return right.windows - left.windows;
    return firstStartForRanking(right) - firstStartForRanking(left);
  };
  const recordNode = (
    states: Record<PlanPhase, Map<string, number>>,
    node: PlanNode
  ) => {
    const stateMap = states[node.phase];
    assert(node.warmupDebtMs >= 0);
    if (node.phase !== "charging") {
      assert(node.warmupDebtMs === 0);
    }
    const deliveredMs = Math.min(node.deliveredMs, targetMaxMs);
    const normalizedNode = deliveredMs === node.deliveredMs ? node : { ...node, deliveredMs };
    const stateKey = `${normalizedNode.deliveredMs}:${normalizedNode.scheduledMs}:${normalizedNode.warmupDebtMs}`;
    const existingIndex = stateMap.get(stateKey);
    if (existingIndex !== undefined) {
      if (compareContinuationNodes(nodes[existingIndex], normalizedNode) >= 0) {
        nodesPrunedDominated++;
        return;
      }
      nodesPrunedReplaced++;
    }
    nodes.push(normalizedNode);
    nodesRecorded++;
    const nodeIndex = nodes.length - 1;
    stateMap.set(stateKey, nodeIndex);
  };
  const countFrontierNodes = (states: Record<PlanPhase, Map<string, number>>): number => {
    let count = 0;
    for (const phase of phases) {
      count += states[phase].size;
    }
    return count;
  };
  const frontierSummary = (states: Record<PlanPhase, Map<string, number>>): string => {
    return phases.map((phase) => {
      const buckets = states[phase].size;
      return `${phase}:buckets=${buckets},states=${buckets}`;
    }).join(" ");
  };

  const initialPhase: PlanPhase = isCharging
    ? atomicSteps[0].start === hardStart ? "charging" : "stopped"
    : "idle";
  let states = makePhaseMaps();
  recordNode(states, {
    prev: null,
    action: "seed",
    stepIndex: null,
    phase: initialPhase,
    deliveredMs: 0,
    scheduledMs: 0,
    warmupDebtMs: 0,
    chargeCostMs: 0,
    windows: 0,
  });
  vehicleLog(
    LogLevel.Trace,
    vehicleUUID,
    `scheduleWindows(${scheduleTag}): seed phase=${initialPhase} frontier=${frontierSummary(states)}`
  );

  for (let stepIndex = 0; stepIndex < atomicSteps.length; stepIndex++) {
    const step = atomicSteps[stepIndex];
    const nextStates = makePhaseMaps();
    for (const phase of phases) {
      for (const stateIndex of states[phase].values()) {
        const state = nodes[stateIndex];
        assert(state);
        const skipPhase: PlanPhase = phase === "charging" ? "stopped" : phase;
        recordNode(nextStates, {
          prev: stateIndex,
          action: "skip",
          stepIndex,
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
          action: "take",
          stepIndex,
          phase: nextPhase,
          deliveredMs: state.deliveredMs + deliveredIncrementMs,
          scheduledMs: state.scheduledMs + step.duration,
          warmupDebtMs: nextPhase === "charging" ? remainingWarmupDebtMs : 0,
          chargeCostMs: state.chargeCostMs + step.chargeCostMs,
          windows: state.windows + (startsNewWindow ? 1 : 0),
          firstStartMs: state.firstStartMs ?? step.start,
        });
      }
    }
    vehicleLog(
      LogLevel.Trace,
      vehicleUUID,
      `scheduleWindows(${scheduleTag}): after step=${stepIndex + 1}/${atomicSteps.length} ` +
      `${new Date(step.start).toISOString()}..${new Date(step.stop).toISOString()}@${fmtDbPrice(step.price)} ` +
      `frontier=${frontierSummary(nextStates)} total=${countFrontierNodes(nextStates)} nodesRecorded=${nodesRecorded} ` +
      `prunedDominated=${nodesPrunedDominated} prunedReplaced=${nodesPrunedReplaced}`
    );
    states = nextStates;
    await yieldToEventLoop();
  }

  const isFeasibleAverage = (node: PlanNode): boolean => {
    return maxPrice === undefined
      || node.scheduledMs === 0
      || node.chargeCostMs <= maxPrice * node.scheduledMs;
  };

  let bestIndex: number | undefined;
  let feasibleFinalStates = 0;
  for (const phase of phases) {
    for (const stateIndex of states[phase].values()) {
      const node = nodes[stateIndex];
      if (!isFeasibleAverage(node)) continue;
      feasibleFinalStates++;
      if (bestIndex === undefined || compareFinalNodes(node, nodes[bestIndex]) > 0) {
        bestIndex = stateIndex;
      }
    }
  }

  if (bestIndex === undefined) {
    vehicleLog(
      LogLevel.Trace,
      vehicleUUID,
      `scheduleWindows(${scheduleTag}): no feasible final state frontier=${frontierSummary(states)} total=${countFrontierNodes(states)} ` +
      `nodesRecorded=${nodesRecorded} prunedDominated=${nodesPrunedDominated} prunedReplaced=${nodesPrunedReplaced}`
    );
    return scheduled;
  }
  const best = nodes[bestIndex];
  if (best.deliveredMs <= 0) {
    vehicleLog(LogLevel.Trace, vehicleUUID, `scheduleWindows(${scheduleTag}): no feasible intervals after constraints`);
    return scheduled;
  }
  vehicleLog(
    LogLevel.Trace,
    vehicleUUID,
    `scheduleWindows(${scheduleTag}): best phase=${best.phase} delivered=${Math.round(best.deliveredMs / 60e3)}min ` +
    `scheduled=${Math.round(best.scheduledMs / 60e3)}min chargeCost=${best.chargeCostMs} windows=${best.windows} ` +
    `warmupDebt=${Math.round(best.warmupDebtMs / 60e3)}min firstStart=${new Date(firstStartForRanking(best)).toISOString()} ` +
    `feasibleFinalStates=${feasibleFinalStates}`
  );
  const deliveredMs = Math.min(best.deliveredMs, targetMaxMs);
  if (deliveredMs < targetMaxMs) {
    vehicleLog(
      LogLevel.Trace,
      vehicleUUID,
      `scheduleWindows(${scheduleTag}): best-effort fallback scheduled=${Math.round(deliveredMs / 60e3)}min ` +
      `requested=${Math.round(targetMaxMs / 60e3)}min`
    );
  }

  const selectedSteps: AtomicStep[] = [];
  for (let nodeIndex: number | null = bestIndex; nodeIndex !== null; nodeIndex = nodes[nodeIndex].prev) {
    const node = nodes[nodeIndex];
    if (node.action === "take") {
      assert(node.stepIndex !== null);
      selectedSteps.push(atomicSteps[node.stepIndex]);
    }
  }
  selectedSteps.reverse();
  vehicleLog(
    LogLevel.Trace,
    vehicleUUID,
    `scheduleWindows(${scheduleTag}): selectedSteps=${selectedSteps.map((step) =>
      `${new Date(step.start).toISOString()}..${new Date(step.stop).toISOString()}@${fmtDbPrice(step.price)}`
    ).join(", ")}`
  );

  const reconstructedWindows: ChargeWindow[] = [];
  for (const step of selectedSteps) {
    const last = reconstructedWindows[reconstructedWindows.length - 1];
    if (last && last.stop === step.start) {
      last.stop = step.stop;
    } else {
      reconstructedWindows.push({ start: step.start, stop: step.stop });
    }
  }

  vehicleLog(LogLevel.Trace, vehicleUUID, `scheduleWindows(${scheduleTag}): accepted avgPrice=${fmtDbPrice(best.chargeCostMs / best.scheduledMs)} ` +
    `windows=${reconstructedWindows.map((w) => `${new Date(w.start).toISOString()}..${new Date(w.stop).toISOString()}`).join(", ")}`
  );
  scheduled.windows = reconstructedWindows;
  scheduled.scheduledMs = best.scheduledMs;
  scheduled.deliveredMs = deliveredMs;
  return scheduled;
}
