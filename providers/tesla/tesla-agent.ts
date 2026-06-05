/* eslint-disable require-atomic-updates */
/**
 * @file TeslaAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";
import {
  log,
  LogLevel,
  vehicleLog,
  numericStopTime,
  numericStartTime,
  diffObjects,
  delay,
  compareStartStopTimes,
  geoDistance,
  compareStartTimes,
} from "@shared/utils.js";
import { GQLLocationFragment, SCClient, UpdateVehicleParams } from "@shared/sc-client.js";
import config from "./tesla-config.js";
import teslaAPI, { redactSecret, TeslaAPI, TeslaChargeSchedule, TeslaPreconditionSchedule, TeslaScheduleTimeToDate, TeslaTelemetryConfig } from "./tesla-api.js";
import { AgentJob, AbstractAgent, IProviderAgent } from "@providers/provider-agent.js";
import provider, { TeslaServiceData, TeslaProviderMutates, TeslaProviderQueries, TeslaToken } from "./index.js";
import { GQLVehicle, GQLUpdateVehicleDataInput, GQLChargeConnection, GQLChargeType, GQLGeoLocation, GQLScheduleType } from "@shared/sc-schema.js";
import { DEFAULT_LOCATION_RADIUS } from "@shared/smartcharge-defines.js";
import { Consumer, Kafka, LogEntry, logLevel } from "kafkajs";
import * as protobuf from "@bufbuild/protobuf";
import * as telemetryConnectivity from "./telemetry-protos/vehicle_connectivity_pb.js";
import * as telemetryData from "./telemetry-protos/vehicle_data_pb.js";
import * as telemetryError from "./telemetry-protos/vehicle_error_pb.js";
import { RestClientError } from "@shared/restclient.js";

// Telemetry data that is not directly mapped to a vehicle database field
interface TeslaTelemetryData {
  Location: GQLGeoLocation;
  Soc: number;
  Odometer: number;
  OutsideTemp: number;
  InsideTemp: number;
  ModuleTempMin: number;
  ModuleTempMax: number;
  TimeToFullCharge: number;

  HvacPower: telemetryData.HvacPowerState;
  Gear: telemetryData.ShiftState;
  FastChargerPresent: boolean;
  FastChargerType: telemetryData.FastCharger;
  ChargeState: string;
  DetailedChargeState: telemetryData.DetailedChargeStateValue;
  ChargeAmps: number;
  ChargeCurrentRequest: number;
  ChargeCurrentRequestMax: number;
  ChargeEnableRequest: boolean;
  ChargeLimitSoc: number;
  ChargerPhases: number;
  ChargerVoltage: number;
  ACChargingEnergyIn: number;
  ACChargingPower: number;
  DCChargingEnergyIn: number;
  DCChargingPower: number;
  ScheduledChargingMode: telemetryData.ScheduledChargingModeValue;
  ScheduledChargingStartTime: number;
  ScheduledChargingPending: boolean;

  DriverSeatOccupied: boolean;
  HvacAutoMode: telemetryData.HvacAutoModeState;
  ClimateKeeperMode: telemetryData.ClimateKeeperModeState;
  SentryMode: telemetryData.SentryModeState;

  VehicleName: string;
  CarType: telemetryData.CarTypeValue;
  Trim: string;
  ExteriorColor: string;
  RoofColor: string;
  WheelType: string;
}
type TelemetryFields = { [K in keyof TeslaTelemetryData]: {
  interval_seconds: number,
  minimum_delta?: number,
  resend_interval_seconds?: number,
}; };
const telemetryFields: TelemetryFields = {
  Location: { interval_seconds: 60, minimum_delta: 0.001 }, // 0.001 degrees = 100 meters
  Soc: { interval_seconds: 60, minimum_delta: 0.01, resend_interval_seconds: 600 }, // Resend every 10 minutes as a heartbeat
  Odometer: { interval_seconds: 15, minimum_delta: 0.05 }, // 0.05 miles = 80 meters
  OutsideTemp: { interval_seconds: 60, minimum_delta: 0.5 },
  InsideTemp: { interval_seconds: 30, minimum_delta: 0.5 },
  ModuleTempMin: { interval_seconds: 60, minimum_delta: 0.5 },
  ModuleTempMax: { interval_seconds: 60, minimum_delta: 0.5 },
  TimeToFullCharge: { interval_seconds: 10, minimum_delta: 0.02 }, // 0.02 hours = 1.2 minutes

  VehicleName: { interval_seconds: 5 },

  HvacPower: { interval_seconds: 5 },
  Gear: { interval_seconds: 15 },
  FastChargerPresent: { interval_seconds: 5 },
  FastChargerType: { interval_seconds: 5 },
  ChargeState: { interval_seconds: 5 },
  DetailedChargeState: { interval_seconds: 5 },
  ChargeAmps: { interval_seconds: 5, minimum_delta: 0.1 },
  ChargeCurrentRequest: { interval_seconds: 5 },
  ChargeCurrentRequestMax: { interval_seconds: 5 },
  ChargeEnableRequest: { interval_seconds: 5 },
  ChargeLimitSoc: { interval_seconds: 5 },
  ChargerPhases: { interval_seconds: 5 },
  ChargerVoltage: { interval_seconds: 5, minimum_delta: 5.0 },
  ACChargingEnergyIn: { interval_seconds: 10, minimum_delta: 0.03 }, // 0.03 kWh = 30 Wh
  ACChargingPower: { interval_seconds: 10, minimum_delta: 0.1 }, // 0.1 kW = 100 W
  DCChargingEnergyIn: { interval_seconds: 10, minimum_delta: 0.2 }, // 0.2 kWh = 200 Wh
  DCChargingPower: { interval_seconds: 10, minimum_delta: 1.0 }, // 1.0 kW = 1000 W
  ScheduledChargingMode: { interval_seconds: 60 },
  ScheduledChargingStartTime: { interval_seconds: 60 },
  ScheduledChargingPending: { interval_seconds: 60 },

  DriverSeatOccupied: { interval_seconds: 5 },
  HvacAutoMode: { interval_seconds: 10 },
  ClimateKeeperMode: { interval_seconds: 10 },
  SentryMode: { interval_seconds: 60 },

  CarType: { interval_seconds: 600 },
  Trim: { interval_seconds: 600 },
  ExteriorColor: { interval_seconds: 600 },
  RoofColor: { interval_seconds: 600 },
  WheelType: { interval_seconds: 600 },
};

interface NumericChargePlan {
  scheduleID?: number;
  chargeType?: GQLChargeType;
  chargeStart: number | null;
  chargeStop: number | null;
}

interface TeslaScheduleSyncIssue {
  kind: "incorrect" | "drift";
  locationID: string;
  since: number;
}

interface VehicleEntry {
  vin: string;
  vehicleUUID: string | null;
  job: TeslaAgentJob | null;
  telemetryConfig: Record<string, any> | null;
  dbData: GQLVehicle | null;

  telemetryData: Partial<TeslaTelemetryData>;
  lastTelemetryData: Partial<TeslaTelemetryData>;

  network: { [connectionId: string]: string };

  vehicleDataInput: Partial<GQLUpdateVehicleDataInput>;
  lastVehicleDataInput: Partial<GQLUpdateVehicleDataInput>;

  isUpdating: boolean;
  updatePromise: Promise<void> | null;

  tsUpdate: number;

  isSleepy: boolean;
  isOnline: boolean;
  lastScheduleSyncAt?: number;
  lastScheduleSyncAttemptAt?: number;
  lastScheduleMutationAt?: number;
  lastPlugInAt?: number;
  lastImmediateScheduleCheckAt?: number;
  lastChargingAt?: number;
  lastEmergencyWakeUpAt?: number;

  charge_schedules?: { [id: number]: TeslaChargeSchedule }; // Cached charge schedules
  precondition_schedules?: { [id: number]: TeslaPreconditionSchedule }; // Cached precondition schedules
}

const logVehicle = (level: LogLevel, vehicle: VehicleEntry, data: unknown) => {
  // Tesla issues are investigated by VIN first. Keep VIN on every vehicle-scoped
  // log line, and include the internal vehicle UUID too once the vehicle is mapped.
  const vehicleRef = vehicle.vehicleUUID ? `${vehicle.vehicleUUID} ${vehicle.vin}` : vehicle.vin;
  vehicleLog(level, vehicleRef, data);
};

export function teslaSchedulePurposeCadenceMs(
  connected: boolean,
  location: GQLLocationFragment,
  distanceToLocationM: number | null,
  lockedInCadenceMs: number,
  fluidCadenceMs: number
): number {
  const nearChargeLocationThresholdM = location.geoFenceRadius || DEFAULT_LOCATION_RADIUS;
  if (connected || (distanceToLocationM !== null && distanceToLocationM < nearChargeLocationThresholdM)) {
    return lockedInCadenceMs;
  }
  return fluidCadenceMs;
}

export function teslaScheduleServesRequestedPurpose(
  connected: boolean,
  detailedChargeState: telemetryData.DetailedChargeStateValue | undefined,
  existing: NumericChargePlan,
  requested: NumericChargePlan,
  now: number,
  location: GQLLocationFragment,
  distanceToLocationM: number | null,
  lockedInCadenceMs: number,
  fluidCadenceMs: number
): boolean {
  const existingStart = numericStartTime(existing.chargeStart);
  const existingStop = numericStopTime(existing.chargeStop);
  const requestedStart = numericStartTime(requested.chargeStart);
  const requestedStop = numericStopTime(requested.chargeStop);

  if (teslaScheduleMatchesExactly(existing, requested)) {
    return true;
  }
  if (requestedStop < now && existingStop < now && (now - existingStop) < 5 * 60 * 60e3) {
    return true;
  }
  if (requestedStart < now && existingStart < now && existingStop === requestedStop) {
    if (detailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateStopped
      && (now - existingStart) > 5 * 60 * 60e3) {
      return false;
    }
    return true;
  }

  const nearChargeLocationThresholdM = location.geoFenceRadius || DEFAULT_LOCATION_RADIUS;
  const immediateBand = distanceToLocationM !== null && distanceToLocationM < nearChargeLocationThresholdM;
  const cadenceMs = teslaSchedulePurposeCadenceMs(connected, location, distanceToLocationM, lockedInCadenceMs, fluidCadenceMs);
  if (requestedStart < now) {
    const nearEnd = requestedStop <= now + lockedInCadenceMs;
    if (nearEnd) {
      return existingStart <= now
        && Math.abs(existingStop - requestedStop) <= lockedInCadenceMs;
    }
    return existingStart <= now && existingStop > now;
  }

  if (connected) {
    return existingStart > now
      && Math.abs(existingStart - requestedStart) <= lockedInCadenceMs;
  }

  if (immediateBand) {
    return existingStart > now;
  }

  return existingStart > now
    && Math.abs(existingStart - requestedStart) <= cadenceMs;
}

function teslaScheduleMatchesExactly(existing: NumericChargePlan, requested: NumericChargePlan): boolean {
  return numericStartTime(existing.chargeStart) === numericStartTime(requested.chargeStart)
    && numericStopTime(existing.chargeStop) === numericStopTime(requested.chargeStop);
}

export function teslaWantedSocLimit(wantedSoc: number | undefined): number | null {
  if (wantedSoc === undefined) return null;
  return Math.max(config.TESLA_LOWEST_POSSIBLE_CHARGETO, Math.min(wantedSoc, 100));
}

function classifyScheduleSyncIssue(
  requestedSchedule: ReadonlyArray<NumericChargePlan>,
  existingSchedules: ReadonlyArray<NumericChargePlan>,
  now: number,
  hasInexactPurposeMatch: boolean
): TeslaScheduleSyncIssue["kind"] | null {
  const relevantRequestedSchedule = requestedSchedule.filter((r) => numericStopTime(r.chargeStop) > now);
  if (relevantRequestedSchedule.length === 0) {
    return null;
  }
  if (relevantRequestedSchedule[0].scheduleID === undefined) {
    const firstRequested = relevantRequestedSchedule[0];
    const firstExisting = existingSchedules
      .filter((s) => numericStopTime(s.chargeStop) > now)
      .sort((a, b) => compareStartStopTimes(a.chargeStart, a.chargeStop, b.chargeStart, b.chargeStop))[0];
    if (!firstExisting) {
      return "incorrect";
    }
    if (numericStartTime(firstExisting.chargeStart) > numericStartTime(firstRequested.chargeStart)) {
      return "incorrect";
    }
    // An earlier start, earlier stop, or longer onboard schedule can still wake the car
    // so Smart Charge can correct it before the desired charging behavior is affected.
    return "drift";
  }
  if (relevantRequestedSchedule.some((r) => r.scheduleID === undefined)) {
    return "drift";
  }
  if (hasInexactPurposeMatch) {
    return "drift";
  }
  return null;
}

function classifyChargingSetupSyncIssue(
  requestedSchedule: ReadonlyArray<NumericChargePlan>,
  existingSchedules: ReadonlyArray<NumericChargePlan>,
  now: number,
  hasInexactPurposeMatch: boolean,
  wantedSocLimit: number | null,
  actualSocLimit: number | undefined,
  currentSoc: number | undefined,
  connected: boolean
): TeslaScheduleSyncIssue["kind"] | null {
  const scheduleIssueKind = classifyScheduleSyncIssue(requestedSchedule, existingSchedules, now, hasInexactPurposeMatch);
  if (connected && wantedSocLimit !== null && actualSocLimit !== undefined) {
    if ((currentSoc ?? Number.POSITIVE_INFINITY) < wantedSocLimit && actualSocLimit < wantedSocLimit) {
      return "incorrect";
    }
    if (actualSocLimit !== wantedSocLimit) {
      return scheduleIssueKind === "incorrect" ? "incorrect" : "drift";
    }
  }
  return scheduleIssueKind;
}

export function teslaShouldMaintainRemoteHomeSchedule(
  connected: boolean,
  location: GQLLocationFragment,
  distanceToLocationM: number | null,
  approachChargeLocationM: number
): boolean {
  if (connected) {
    return true;
  }
  const nearChargeLocationThresholdM = location.geoFenceRadius || DEFAULT_LOCATION_RADIUS;
  if (distanceToLocationM !== null && distanceToLocationM < nearChargeLocationThresholdM) {
    return true;
  }
  return distanceToLocationM !== null && distanceToLocationM < approachChargeLocationM;
}

function formatTelemetryValue(v: telemetryData.Value["value"]): string {
  const value = v.value;
  if (value === undefined || value === null) {
    return `${value}`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

interface TeslaAgentState {
  [vehicleUUID: string]: string;  // vehicleUUID -> vin
}
interface TeslaAgentJob extends AgentJob {
  serviceData: TeslaServiceData;
  mapped: number;
  state: TeslaAgentState;
  teslaApiQueue?: Promise<void>;
}

function mapTelemetryNumber(v: telemetryData.Value["value"]): number {
  switch (v.case) {
    case "stringValue": case "intValue": case "floatValue": case "doubleValue":
      return +v.value;
    default:
      log(LogLevel.Warning, `Tesla Telemetry invalid number value: ${formatTelemetryValue(v)} (${v.case})`);
      return NaN;
  }
}

const TeslaScheduleIDs = {
  First: 197400,
  Last: 197498,
  Precondition: 197499,
};

function stringifyWithTimestamps(data: any): string {
  return JSON.stringify(data, (key, value) => {
    if (typeof value === "number" && value > 1e12 && value < 1e13) {
      return new Date(value).toISOString();
    }
    return value;
  });
}

function normalizeChargeSchedules(schedules: { [id: number]: TeslaChargeSchedule } | undefined): unknown[] {
  return Object.values(schedules || {})
    .filter((s) => s.id >= TeslaScheduleIDs.First && s.id <= TeslaScheduleIDs.Last)
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: s.id,
      latitude: s.latitude,
      longitude: s.longitude,
      start_enabled: s.start_enabled,
      start_time: s.start_time,
      end_enabled: s.end_enabled,
      end_time: s.end_time,
      days_of_week: s.days_of_week,
      one_time: s.one_time,
      enabled: s.enabled,
    }));
}

function normalizePreconditionSchedules(schedules: { [id: number]: TeslaPreconditionSchedule } | undefined): unknown[] {
  return Object.values(schedules || {})
    .filter((s) => s.id === TeslaScheduleIDs.Precondition)
    .sort((a, b) => a.id - b.id)
    .map((s) => ({
      id: s.id,
      latitude: s.latitude,
      longitude: s.longitude,
      precondition_time: s.precondition_time,
      days_of_week: s.days_of_week,
      one_time: s.one_time,
      enabled: s.enabled,
    }));
}

// Epsilon covers float32 rounding (~8e-6 ULP near 60°N) plus the observed DB-to-float32
// conversion drift (up to ~3e-5) from micro-degree integer storage vs IEEE 754 float32.
const SCHEDULE_COORD_ABS_EPSILON = 0.00005;

function sameCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) <= SCHEDULE_COORD_ABS_EPSILON;
}

function equalChargeSchedules(
  left: { [id: number]: TeslaChargeSchedule } | undefined,
  right: { [id: number]: TeslaChargeSchedule } | undefined
): boolean {
  const isSmartChargeId = (id: number) => id >= TeslaScheduleIDs.First && id <= TeslaScheduleIDs.Last;
  const leftSchedules = Object.values(left || {}).filter((s) => isSmartChargeId(s.id)).sort((a, b) => a.id - b.id);
  const rightSchedules = Object.values(right || {}).filter((s) => isSmartChargeId(s.id)).sort((a, b) => a.id - b.id);
  if (leftSchedules.length !== rightSchedules.length) return false;
  return leftSchedules.every((schedule, index) => {
    const other = rightSchedules[index];
    assert(other);
    return schedule.id === other.id
      && sameCoordinate(schedule.latitude, other.latitude)
      && sameCoordinate(schedule.longitude, other.longitude)
      && schedule.start_enabled === other.start_enabled
      && schedule.start_time === other.start_time
      && schedule.end_enabled === other.end_enabled
      && schedule.end_time === other.end_time
      && schedule.days_of_week === other.days_of_week
      && schedule.one_time === other.one_time
      && schedule.enabled === other.enabled;
  });
}

function equalPreconditionSchedules(
  left: { [id: number]: TeslaPreconditionSchedule } | undefined,
  right: { [id: number]: TeslaPreconditionSchedule } | undefined
): boolean {
  const leftSchedules = Object.values(left || {}).filter((s) => s.id === TeslaScheduleIDs.Precondition).sort((a, b) => a.id - b.id);
  const rightSchedules = Object.values(right || {}).filter((s) => s.id === TeslaScheduleIDs.Precondition).sort((a, b) => a.id - b.id);
  if (leftSchedules.length !== rightSchedules.length) return false;
  return leftSchedules.every((schedule, index) => {
    const other = rightSchedules[index];
    assert(other);
    return schedule.id === other.id
      && sameCoordinate(schedule.latitude, other.latitude)
      && sameCoordinate(schedule.longitude, other.longitude)
      && schedule.precondition_time === other.precondition_time
      && schedule.days_of_week === other.days_of_week
      && schedule.one_time === other.one_time
      && schedule.enabled === other.enabled;
  });
}

export class TeslaAgent extends AbstractAgent {
  private static readonly EMERGENCY_WAKE_GRACE_MS = 15 * 60e3;
  private static readonly EMERGENCY_WAKE_COOLDOWN_MS = 23 * 60 * 60e3;
  private static readonly CHARGE_SCHEDULE_QUANTUM_MS = 15 * 60e3;
  private static readonly EMERGENCY_WAKE_PROVIDER_FIELD = "emergency_wakeup_at";
  private static readonly SCHEDULE_SYNC_ISSUE_PROVIDER_FIELD = "schedule_sync_issue";
  private static readonly IDLE_SERVICE_INTERVAL_S = 5 * 60;
  private static readonly ACTIVE_SERVICE_INTERVAL_S = 30;
  private static readonly URGENT_SERVICE_INTERVAL_S = 10;
  private static readonly FLUID_SCHEDULE_CADENCE_MS = 30 * 60e3;
  private static readonly LOCKED_IN_SCHEDULE_CADENCE_MS = 5 * 60e3;
  // 50 km is roughly 30-35 minutes of driving at mixed Swedish road speeds.
  // Beyond this, a home schedule update is unlikely to help before the vehicle parks
  // or loses coverage, so we stop maintaining it entirely.
  private static readonly APPROACH_CHARGE_LOCATION_M = 50e3;
  private static readonly SCHEDULE_SYNC_RETRY_MS = 60e3;

  public name: string = provider.name;
  public kafkaClient: Kafka;
  public kafkaConsumer: Consumer;
  private telemetryConfigBackoff: { [vin: string]: { step: number; until: number } } = {};
  constructor(scClient: SCClient) {
    super(scClient);
    this.kafkaClient = new Kafka({
      clientId: "smartcharge-broker",
      brokers: [config.TESLA_TELEMETRY_KAFKA_BROKER],
      logLevel: logLevel.INFO,
      logCreator: (_level: logLevel) => (entry: LogEntry) => {
        log(entry.level === logLevel.ERROR ? LogLevel.Error
          : entry.level === logLevel.WARN ? LogLevel.Warning
          : entry.level === logLevel.INFO ? LogLevel.Info
          : LogLevel.Debug, `Kafka ${entry.namespace}: ${entry.log.message}`
        );
      },
    });
    this.kafkaConsumer = this.kafkaClient.consumer({
      groupId: "smartcharge-broker",
    });
    this.kafkaConsumer.connect();
    this.kafkaConsumer.subscribe({
      topics: ["tesla_connectivity", "tesla_error", "tesla_V"],
      fromBeginning: true,
    });
    this.kafkaConsumer.run({
      eachMessage: async ({ topic, message }) => {
        if (message.value === null) {
          log(LogLevel.Error, `Tesla Telemetry message value is null`);
          return;
        }
        if (topic === "tesla_connectivity") {
          const data = protobuf.fromBinary(
            telemetryConnectivity.VehicleConnectivitySchema,
            new Uint8Array(message.value)
          );
          await this.telemetryConnectivityMessage(data);
        } else if (topic === "tesla_V") {
          const data = protobuf.fromBinary(
            telemetryData.PayloadSchema,
            new Uint8Array(message.value)
          );
          for (const d of data.data) {
            await this.telemetryDataMessage(data.vin, d);
          }
        } else if (topic === "tesla_error") {
          const data = protobuf.fromBinary(
            telemetryError.VehicleErrorsSchema,
            new Uint8Array(message.value)
          );
          for (const error of data.errors) {
            log(LogLevel.Error, `Tesla Telemetry error ${error.name} (${JSON.stringify(error.tags)}): ${error.body}`);
          }
        } else {
          log(LogLevel.Error, `Unknown Tesla Telemetry topic: ${topic}`);
        }
      },
    });
    process.on("SIGINT", this.shutdown);
    process.on("SIGTERM", this.shutdown);
  }
  public async shutdown() {
    log(LogLevel.Info, `Gracefully shutting down`);
    if (this.kafkaConsumer) {
      await this.kafkaConsumer.disconnect();
    }
    if (this.vehicles) {
      for (const v of Object.values(this.vehicles)) {
        if (v.updatePromise) {
          await v.updatePromise;
        }
      }
    }
  }

  public vehicles: { [vin: string]: VehicleEntry } = {};

  public newState(): TeslaAgentState {
    return {};
  }

  public async refreshToken(job: TeslaAgentJob) {
    const token = await this.scClient.providerMutate("tesla", {
      mutation: TeslaProviderMutates.RefreshToken,
      service_uuid: job.serviceID,
    });
    if (token === null) {
      log(LogLevel.Warning, `TeslaProviderMutates.RefreshToken returned null`);
      throw new Error("TeslaProviderMutates.RefreshToken returned null");
    }
    job.serviceData.token = token as TeslaToken;
    delete job.serviceData.invalid_token;
    log(LogLevel.Debug, `Updated token for ${job.serviceID} to ${redactSecret(token.access_token)}`);
  }

  // Check token and refresh through server provider API
  public async maintainToken(job: TeslaAgentJob) {
    // API Token check and update
    const token = job.serviceData.token as TeslaToken;
    if (TeslaAPI.tokenExpired(token)) {
      log(LogLevel.Debug, `${job.serviceID} token expired, calling server API for refresh`);
      // Token has expired, run it through server
      await this.refreshToken(job);
    }
  }

  public async callTeslaAPI<T extends any[], R>(
    job: TeslaAgentJob,
    fn: (...args: [...T, TeslaToken]) => Promise<R>,
    ...args: T
  ): Promise<R> {
    // Serialize Tesla API calls per service/account. This is intentionally broader
    // than per-vehicle queueing: it keeps ordering simple and dampens paid API bursts,
    // at the cost of one vehicle being able to delay another on the same Tesla account.
    const queue = job.teslaApiQueue || Promise.resolve();
    const queued = queue.then(async () => {
      await this.maintainToken(job);
      return await fn.apply(teslaAPI, [...args, job.serviceData.token]);
    });
    job.teslaApiQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private vehicleEntry(vin: string): VehicleEntry {
    if (!this.vehicles[vin]) {
      this.vehicles[vin] = {
        vin: vin,
        vehicleUUID: null,
        job: null,
        telemetryConfig: null,
        telemetryData: {},
        network: {},
        lastTelemetryData: {},
        dbData: null,
        vehicleDataInput: {},
        lastVehicleDataInput: {},
        isUpdating: false,
        updatePromise: null,
        isOnline: false,
        isSleepy: false,
        tsUpdate: Date.now(),
      };
    }
    return this.vehicles[vin];
  }

  // We can cache location, because it is not expected to change
  private locationCache: { [locationID: string]: GQLLocationFragment } = {};
  private async getLocation(locationID: string): Promise<GQLLocationFragment> {
    if (!this.locationCache[locationID]) {
      this.locationCache[locationID] = await this.scClient.getLocation(locationID);
    }
    return this.locationCache[locationID];
  }

  private locationTimezoneOffset(location: GQLLocationFragment, d: Date): number {
    // Ignore location for now, let's assume every location has Europe/Stockholm timezone
    // TODO: Implement location timezone from getLocation(locationUUID) data
    const utcTime = new Date(d.toLocaleString("sv-SE", { timeZone: "UTC" }));
    const localTime = new Date(d.toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }));
    return localTime.getTime() - utcTime.getTime();
  }

  // Converts UTC time to local time at location
  private ConvertUTCtoLocationTime(location: GQLLocationFragment, d: Date): Date {
    return new Date(d.getTime() + this.locationTimezoneOffset(location, d));
  }

  // Converts local time at location to UTC time
  private ConvertLocationTimeToUTC(location: GQLLocationFragment, d: Date): Date {
    return new Date(d.getTime() - this.locationTimezoneOffset(location, d));
  }

  private requestServiceWork(vehicle: VehicleEntry, targetIntervalS: number, reason: string) {
    if (!vehicle.job) return;
    vehicle.job.interval = Math.min(vehicle.job.interval, targetIntervalS);
    vehicle.job.nextrun = Math.min(vehicle.job.nextrun, Date.now());
    logVehicle(
      LogLevel.Trace,
      vehicle,
      `Requested Tesla service work in ${targetIntervalS}s due to ${reason}`
    );
  }

  private isChargingState(
    state: telemetryData.DetailedChargeStateValue | undefined
  ): boolean {
    return state === telemetryData.DetailedChargeStateValue.DetailedChargeStateCharging
      || state === telemetryData.DetailedChargeStateValue.DetailedChargeStateStarting;
  }

  private shouldDeferScheduleMutation(
    vehicle: VehicleEntry,
    requestedSchedule: ReadonlyArray<NumericChargePlan>,
    now: number,
    location: GQLLocationFragment,
    distanceToLocationM: number | null
  ): boolean {
    const cooldownMs = teslaSchedulePurposeCadenceMs(
      Boolean(vehicle.dbData?.isConnected || this.isConnected(vehicle)),
      location,
      distanceToLocationM,
      TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
      TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
    );
    if (!vehicle.lastScheduleMutationAt || vehicle.lastScheduleMutationAt + cooldownMs <= now) {
      return false;
    }
    const nextAllowedMutationAt = vehicle.lastScheduleMutationAt + cooldownMs;
    const firstRelevantStart = requestedSchedule
      .map((window) => numericStartTime(window.chargeStart))
      .filter((start) => start > now)
      .sort((a, b) => a - b)[0];
    return firstRelevantStart !== undefined && nextAllowedMutationAt < firstRelevantStart;
  }

  private scheduleAuditIntervalMs(now: number): number | null {
    // Development-only schedule audit with a hard sunset so it cannot linger in release code.
    // Keep dates in the past so audit remains disabled unless explicitly reintroduced.
    // - run every 10 minutes until May 1, 2026
    // - then every 30 minutes until June 1, 2026
    // - then disable completely
    if (now < Date.UTC(2026, 4, 1)) return 10 * 60e3;
    if (now < Date.UTC(2026, 5, 1)) return 30 * 60e3;
    return null;
  }

  private lastEmergencyWakeUpAt(vehicle: VehicleEntry): number | undefined {
    const cached = vehicle.lastEmergencyWakeUpAt;
    if (cached !== undefined) return cached;
    const providerValue = vehicle.dbData?.providerData?.[TeslaAgent.EMERGENCY_WAKE_PROVIDER_FIELD];
    if (providerValue === undefined || providerValue === null) return undefined;
    assert(typeof providerValue === "number", `${TeslaAgent.EMERGENCY_WAKE_PROVIDER_FIELD} must be stored as epoch milliseconds`);
    assert(Number.isFinite(providerValue), `${TeslaAgent.EMERGENCY_WAKE_PROVIDER_FIELD} must be a finite epoch millisecond timestamp`);
    vehicle.lastEmergencyWakeUpAt = providerValue;
    return providerValue;
  }

  private async recordEmergencyWakeUp(vehicle: VehicleEntry, at: number) {
    vehicle.lastEmergencyWakeUpAt = at;
    if (!vehicle.vehicleUUID) return;
    vehicle.dbData = await this.scClient.updateVehicle({
      id: vehicle.vehicleUUID,
      providerData: {
        [TeslaAgent.EMERGENCY_WAKE_PROVIDER_FIELD]: at,
      },
    });
  }

  private async updateScheduleSyncIssue(vehicle: VehicleEntry, issue: TeslaScheduleSyncIssue | null) {
    const current = vehicle.dbData?.providerData?.[TeslaAgent.SCHEDULE_SYNC_ISSUE_PROVIDER_FIELD] as TeslaScheduleSyncIssue | null | undefined;
    if (issue === null) {
      if (current === undefined || current === null) return;
    } else if (
      current
      && current.kind === issue.kind
      && current.locationID === issue.locationID
    ) {
      return;
    }
    assert(vehicle.vehicleUUID, "vehicle.vehicleUUID is null");
    assert(vehicle.dbData, "vehicle.dbData is null");
    vehicle.dbData = await this.scClient.updateVehicle({
      id: vehicle.vehicleUUID,
      providerData: {
        [TeslaAgent.SCHEDULE_SYNC_ISSUE_PROVIDER_FIELD]: issue,
      },
    });
  }

  private async tryEmergencyWakeForCharging(
    job: TeslaAgentJob,
    vehicle: VehicleEntry,
    requestedSchedule: ReadonlyArray<NumericChargePlan>,
    wantedSoc: number | undefined
  ): Promise<boolean> {
    const now = Date.now();
    const activeWindow = requestedSchedule.find((window) => {
      const start = numericStartTime(window.chargeStart);
      const stop = numericStopTime(window.chargeStop);
      return start <= now && now < stop;
    });
    if (!activeWindow || vehicle.isOnline || !(vehicle.dbData?.isConnected || this.isConnected(vehicle))) {
      return false;
    }
    if (this.isChargingState(vehicle.telemetryData.DetailedChargeState)) {
      return false;
    }
    const rawTargetSoc = wantedSoc ?? vehicle.telemetryData.ChargeLimitSoc ?? null;
    const targetSoc = rawTargetSoc === null || rawTargetSoc === undefined
      ? null
      : Math.max(config.TESLA_LOWEST_POSSIBLE_CHARGETO, Math.min(rawTargetSoc, 100));
    if (targetSoc === null || vehicle.telemetryData.Soc === undefined || vehicle.telemetryData.Soc >= targetSoc - 1.5) {
      return false;
    }
    const blockedSince = Math.max(
      numericStartTime(activeWindow.chargeStart),
      vehicle.lastChargingAt || 0
    );
    if (now < blockedSince + TeslaAgent.EMERGENCY_WAKE_GRACE_MS) {
      return false;
    }
    const lastWakeUpAt = this.lastEmergencyWakeUpAt(vehicle);
    if (
      lastWakeUpAt
      && now < lastWakeUpAt + TeslaAgent.EMERGENCY_WAKE_COOLDOWN_MS
    ) {
      logVehicle(
        LogLevel.Debug,
        vehicle,
        `${vehicle.vin} skipping emergency wake-up because the cooldown is still active`
      );
      return false;
    }

    logVehicle(
      LogLevel.Info,
      vehicle,
      `${vehicle.vin} emergency wake-up: connected, below target, and not charging for ${Math.round((now - blockedSince) / 60e3)}m`
    );
    const wake = await this.callTeslaAPI(job, teslaAPI.wakeUp, vehicle.vin);
    const wakeState = wake?.response?.state;
    if (wakeState !== "online") {
      logVehicle(LogLevel.Warning, vehicle, `${vehicle.vin} emergency wake-up did not report online state`);
      return false;
    }
    await this.recordEmergencyWakeUp(vehicle, now);
    await this.refreshVehicleSchedules(job, vehicle, "post-emergency wake");
    return true;
  }

  public async serviceWork(job: TeslaAgentJob) {
    let desiredIntervalS = TeslaAgent.IDLE_SERVICE_INTERVAL_S;

    if (job.serviceData.invalid_token) {
      log(LogLevel.Trace, `Service ${job.serviceID} has an invalid token, skipping work`);
      return;
    }

    const clearTelemetryConfigFor: string[] = [];
    const setTelemetryConfigFor: string[] = [];
    const telemetryBackoffBaseMs = 5.625 * 60e3; // 5.625m -> 6m after ceil
    const telemetryBackoffCapMs = 24 * 60 * 60e3;

    // Map service to vehicles
    if (!job.mapped || (job.serviceData.updated && job.mapped < job.serviceData.updated)) {
      const unmapped = { ...job.state };
      const list = await this.scClient.providerQuery("tesla", {
        query: TeslaProviderQueries.Vehicles,
        service_uuid: job.serviceID,
      });
      if (list == null) {
        log(LogLevel.Trace, `Service ${job.serviceID} vehicle mapping did not complete; retrying mapping later`);
        // Token refresh and transient provider errors are handled elsewhere; do not
        // ramp through active polling intervals before retrying this low-urgency mapping.
        job.interval = TeslaAgent.IDLE_SERVICE_INTERVAL_S;
        return;
      }
      assert(Array.isArray(list));
      for (const v of list) {
        if (v.vehicle_uuid) {
          job.state[v.vehicle_uuid] = v.vin;
          vehicleLog(LogLevel.Debug, v.vehicle_uuid, `Service ${job.serviceID} found vehicle ${v.vin}`);
        } else {
          log(LogLevel.Debug, `Service ${job.serviceID} ignoring vehicle ${v.vin} (no vehicle_uuid)`);
          // Just always trigger a telemetry config clear for uncontolled vehicles
          clearTelemetryConfigFor.push(v.vin);
        }
        delete unmapped[v.vehicle_uuid];
      }
      job.mapped = Date.now();
      for (const uuid of Object.keys(unmapped)) {
        const vin = job.state[uuid];
        vehicleLog(LogLevel.Debug, uuid, `Service ${job.serviceID} unmapping vehicle ${vin} (no longer found)`);
        delete job.state[uuid];
        delete this.vehicles[vin];
        // Just always trigger a telemetry config clear for unmapped vehicles
        clearTelemetryConfigFor.push(vin);
      }
    }

    const waitFor: Promise<any>[] = [];

    // Go through all vehicles and poll database data and handle telemetry config
    for (const uuid of Object.keys(job.state)) {
      const data = await this.scClient.getVehicle(uuid);
      const vehicle = this.vehicleEntry(job.state[uuid]);

      if (vehicle.vehicleUUID === null) {
        // Not loaded yet
        vehicle.vehicleUUID = uuid;
        vehicle.job = job;
        vehicle.dbData = data;

        const t: TeslaTelemetryData | undefined = data.providerData.telemetryData;
        const d = {
          id: uuid,
          geoLocation: data.geoLocation,
          batteryLevel: data.batteryLevel,
          odometer: data.odometer,
          outsideTemperature: data.outsideTemperature,
          insideTemperature: data.insideTemperature,
          climateControl: data.climateControl,
          isDriving: data.isDriving,
          connectedCharger: (data.isConnected ? t?.FastChargerPresent ? GQLChargeConnection.DC : GQLChargeConnection.AC : null),
          chargingTo: data.chargingTo,
          estimatedTimeLeft: data.estimatedTimeLeft,
          powerUse: t?.ACChargingPower || null,
          energyUsed: t?.ACChargingEnergyIn || null,
          energyAdded: t?.DCChargingEnergyIn || null,
        };
        vehicle.telemetryData = { ...t, ...vehicle.telemetryData };
        vehicle.lastTelemetryData = { ...t };
        vehicle.vehicleDataInput = { ...d, ...vehicle.vehicleDataInput };
        vehicle.lastVehicleDataInput = { ...d };
        vehicle.network = { ...data.providerData.network, ...vehicle.network };
        vehicle.lastEmergencyWakeUpAt = this.lastEmergencyWakeUpAt(vehicle);
        if (this.isChargingState(vehicle.telemetryData.DetailedChargeState)) {
          vehicle.lastChargingAt = Date.now();
        }
        await this.updateOnlineStatus(vehicle);
      } else {
        vehicle.dbData = data;
        // Do not update vehicleDataInput or telemetryData here, because we might be in the middle of an update
      }

      assert(vehicle !== undefined, "vehicle is undefined");

      const backoff = this.telemetryConfigBackoff[vehicle.vin];
      if (backoff && backoff.until > Date.now()) {
        logVehicle(
          LogLevel.Debug,
          vehicle,
          `Telemetry config backoff active for ${vehicle.vin} until ${new Date(backoff.until).toISOString()}`
        );
        continue;
      }

      // Handle telemetry config
      if (!vehicle.telemetryConfig) {
        logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.getFleetTelemetryConfig`);
        vehicle.telemetryConfig = (await this.callTeslaAPI(job, teslaAPI.getFleetTelemetryConfig, vehicle.vin)).response;
      }
      const telemetryExpires = vehicle.telemetryConfig?.config && vehicle.telemetryConfig?.config.exp ? vehicle.telemetryConfig.config.exp : 0;

      if (vehicle.dbData.providerData.disabled) {
        if (vehicle.telemetryConfig?.config) {
          logVehicle(LogLevel.Info, vehicle, `Vehicle ${vehicle.vin} is disabled, but has telemetry config, deleting`);
          clearTelemetryConfigFor.push(vehicle.vin);
          vehicle.telemetryConfig = null; // re-trigger a config read
          continue;
        }
      } else if (!vehicle.telemetryConfig?.config) {
        logVehicle(LogLevel.Info, vehicle, `No telemetry config for ${vehicle.vin}, creating`);
        setTelemetryConfigFor.push(vehicle.vin);
        vehicle.telemetryConfig = null; // re-trigger a config read
        continue;
      } else if (vehicle.telemetryConfig.config.hostname !== config.TESLA_TELEMETRY_HOST
        || vehicle.telemetryConfig.config.port !== config.TESLA_TELEMETRY_PORT
        || vehicle.telemetryConfig.config.ca !== config.TESLA_TELEMETRY_CA.replace(/\\n/g, "\n")) {
        logVehicle(LogLevel.Info, vehicle, `Telemetry config for ${vehicle.vin} has changed, refreshing`);
        setTelemetryConfigFor.push(vehicle.vin);
        vehicle.telemetryConfig = null; // re-trigger a config read
        continue;
      } else if (telemetryExpires < Date.now() / 1e3) {
        logVehicle(LogLevel.Info, vehicle, `Telemetry config for ${vehicle.vin} expired, refreshing`);
        setTelemetryConfigFor.push(vehicle.vin);
        vehicle.telemetryConfig = null; // re-trigger a config read
        continue;
      } else {
        // From here we consider the telemetry config to be working so we can handle vehicle commands
        desiredIntervalS = Math.min(
          desiredIntervalS,
          this.isConnected(vehicle)
            ? this.isChargingState(vehicle.telemetryData.DetailedChargeState)
              ? TeslaAgent.URGENT_SERVICE_INTERVAL_S
              : TeslaAgent.ACTIVE_SERVICE_INTERVAL_S
            : vehicle.isOnline
              ? TeslaAgent.ACTIVE_SERVICE_INTERVAL_S
              : TeslaAgent.IDLE_SERVICE_INTERVAL_S
        );
        if (telemetryExpires < Date.now() / 1e3 + 60 * 60 * 24) {
          logVehicle(LogLevel.Info, vehicle, `Telemetry config for ${vehicle.vin} expires soon, refreshing`);
          setTelemetryConfigFor.push(vehicle.vin);
          vehicle.telemetryConfig = null;
        }

        waitFor.push(this.vehicleWork(job, vehicle));
      }
    }

    for (const vin of clearTelemetryConfigFor) {
      const v = this.vehicles[vin];
      if (v) {
        logVehicle(LogLevel.Trace, v, `Calling TeslaAPI.deleteFleetTelemetryConfig`);
      }
      log(LogLevel.Info, `Deleting telemetry config for ${vin}`);
      waitFor.push(this.callTeslaAPI(job, teslaAPI.deleteFleetTelemetryConfig, vin));
    }
    if (setTelemetryConfigFor.length > 0) {
      log(LogLevel.Info, `Creating telemetry config for ${setTelemetryConfigFor.join(", ")}`);
      for (const vin of setTelemetryConfigFor) {
        const v = this.vehicles[vin];
        if (v) {
          logVehicle(LogLevel.Trace, v, `Calling TeslaAPI.createFleetTelemetryConfig (batch)`);
        }
      }
      let telemetry;
      try {
        telemetry = (await this.callTeslaAPI(job, teslaAPI.createFleetTelemetryConfig, {
          vins: setTelemetryConfigFor,
          config: {
            hostname: config.TESLA_TELEMETRY_HOST,
            port: config.TESLA_TELEMETRY_PORT,
            ca: config.TESLA_TELEMETRY_CA.replace(/\\n/g, "\n"),
            fields: telemetryFields,
            prefer_typed: true,
            exp: Math.trunc(Date.now() / 1e3 + 60 * 60 * 24 * 7), // 7 days
          },
        } as TeslaTelemetryConfig)).response;
      } catch (err) {
        if (err instanceof RestClientError && err.code === 403 && err.message.includes("missing scopes")) {
          for (const vin of setTelemetryConfigFor) {
            const v = this.vehicles[vin];
            const prev = this.telemetryConfigBackoff[vin];
            const step = prev ? prev.step + 1 : 0;
            const rawDelayMs = telemetryBackoffBaseMs * Math.pow(2, step);
            const delayMs = Math.min(
              telemetryBackoffCapMs,
              Math.ceil(rawDelayMs / 60e3) * 60e3
            );
            const until = Date.now() + delayMs;
            this.telemetryConfigBackoff[vin] = { step, until };
            if (v) {
              logVehicle(LogLevel.Warning, v, `Telemetry config blocked by scopes; backoff ${Math.round(delayMs / 60e3)}m`);
            }
          }
          await Promise.all(waitFor);
          return;
        }
        throw err;
      }
      log(LogLevel.Debug, `Telemetry successfully created for ${telemetry.updated_vehicles} vehicles`);
      for (const vin of setTelemetryConfigFor) {
        delete this.telemetryConfigBackoff[vin];
      }
      if (telemetry.skipped_vehicles) {
        log(LogLevel.Debug, `Skipped vehicles: ${JSON.stringify(telemetry)}`);
        if (telemetry.skipped_vehicles.missing_key) {
          for (const vin of telemetry.skipped_vehicles.missing_key) {
            const v = this.vehicles[vin];
            if (v.vehicleUUID) {
              logVehicle(LogLevel.Warning, v, `Missing key for ${vin}`);
              v.dbData = await this.scClient.updateVehicle({
                id: v.vehicleUUID,
                status: "Missing virual key",
                providerData: { error: "No virtual key", disabled: true },
              });
            }
          }
        }
        if (telemetry.skipped_vehicles.unsupported_hardware) {
          for (const vin of telemetry.skipped_vehicles.unsupported_hardware) {
            const v = this.vehicles[vin];
            if (v.vehicleUUID) {
              logVehicle(LogLevel.Warning, v, `Unsupported hardware for ${vin}`);
              v.dbData = await this.scClient.updateVehicle({
                id: v.vehicleUUID,
                status: "Unsupported hardware",
                providerData: { error: "Unsupported hardware", disabled: true },
              });
            }
          }
        }
        if (telemetry.skipped_vehicles.unsupported_firmware) {
          for (const vin of telemetry.skipped_vehicles.unsupported_firmware) {
            const v = this.vehicles[vin];
            if (v.vehicleUUID) {
              logVehicle(LogLevel.Warning, v, `Unsupported firmware for ${vin}`);
              v.dbData = await this.scClient.updateVehicle({
                id: v.vehicleUUID,
                status: "Unsupported firmware",
                providerData: { error: "Unsupported firmware", disabled: true },
              });
            }
          }
        }
        if (telemetry.skipped_vehicles.max_configs) {
          for (const vin of telemetry.skipped_vehicles.max_configs) {
            const v = this.vehicles[vin];
            if (v.vehicleUUID) {
              logVehicle(LogLevel.Warning, v, `Max configs for ${vin}`);
              v.dbData = await this.scClient.updateVehicle({
                id: v.vehicleUUID,
                status: "No more telemetry configs allowed",
                providerData: { error: "Max configs", disabled: true },
              });
            }
          }
        }
      }
    } else {
      this.adjustInterval(job, desiredIntervalS);
    }

    await Promise.all(waitFor);
  }

  // Convert a Tesla charge schedule to the a numeric charge plan
  public convertFromTeslaSchedule(schedule: Partial<TeslaChargeSchedule>, location: GQLLocationFragment): NumericChargePlan {
    schedule.start_time = schedule.start_time || 0;
    schedule.end_time = schedule.end_time || 0;
    let start = null;
    let stop = null;
    if (schedule.start_enabled && schedule.days_of_week) {
      start = TeslaScheduleTimeToDate(schedule.days_of_week, schedule.start_time);
      assert(start !== null, "Invalid start time");
      if (schedule.end_enabled) {
        // Copy start to stop
        stop = new Date(start.getTime());
        if (schedule.end_time < schedule.start_time) {
          stop.setUTCDate(stop.getUTCDate() + 1);
        }
        stop.setUTCHours(Math.floor(schedule.end_time / 60), schedule.end_time % 60, 0, 0);
      }
    } else if (schedule.end_enabled && schedule.days_of_week) {
      stop = TeslaScheduleTimeToDate(schedule.days_of_week, schedule.end_time);
      assert(stop !== null, "Invalid stop time");
    }
    return {
      scheduleID: schedule.id,
      chargeStart: start ? this.ConvertLocationTimeToUTC(location, start).getTime() : null,
      chargeStop: stop ? this.ConvertLocationTimeToUTC(location, stop).getTime() : null,
    };
  }
  public convertToTeslaSchedule(plan: NumericChargePlan, location: GQLLocationFragment): TeslaChargeSchedule {
    const start = plan.chargeStart ? this.ConvertUTCtoLocationTime(location, new Date(plan.chargeStart)) : null;
    const stop = plan.chargeStop ? this.ConvertUTCtoLocationTime(location, new Date(plan.chargeStop)) : null;
    const days = start ? 1 << start.getUTCDay() : stop ? 1 << stop!.getUTCDay() : 0;
    const start_time = start ? start.getUTCHours() * 60 + start.getUTCMinutes() : 0;
    const end_time = stop ? stop.getUTCHours() * 60 + stop.getUTCMinutes() : 0;
    return {
      id: plan.scheduleID || undefined,
      days_of_week: days,
      start_time: start_time,
      start_enabled: start !== null,
      end_time: end_time,
      end_enabled: stop !== null,
      one_time: true,
      enabled: true,
      latitude: location.geoLocation.latitude,
      longitude: location.geoLocation.longitude
    };
  }
  public quantizeTime(t: string | number | null, method: (n: number) => number): number | null {
    const d = typeof t === "string" ? new Date(t).getTime() : typeof t === "number" ? t : null;
    return d === null ? null : method(d / TeslaAgent.CHARGE_SCHEDULE_QUANTUM_MS) * TeslaAgent.CHARGE_SCHEDULE_QUANTUM_MS;
  }
  public async refreshVehicleSchedules(job: TeslaAgentJob, vehicle: VehicleEntry, reason: string, warnOnMismatch = false) {
    logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.getVehicleSchedules (${reason})`);
    vehicle.lastScheduleSyncAttemptAt = Date.now();
    const schedules = (await this.callTeslaAPI(job, teslaAPI.getVehicleSchedules, vehicle.vin)).response;
    const charge_schedules: { [id: number]: TeslaChargeSchedule } = {};
    for (const s of schedules.charge_schedule_data.charge_schedules) {
      charge_schedules[s.id] = s;
    }
    const precondition_schedules: { [id: number]: TeslaPreconditionSchedule } = {};
    for (const s of schedules.preconditioning_schedule_data.precondition_schedules) {
      precondition_schedules[s.id] = s;
    }
    logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} live charge schedules (${reason}): ${stringifyWithTimestamps(normalizeChargeSchedules(charge_schedules))}`);
    logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} live preconditioning schedules (${reason}): ${stringifyWithTimestamps(normalizePreconditionSchedules(precondition_schedules))}`);
    if (warnOnMismatch) {
      const cachedCharge = stringifyWithTimestamps(normalizeChargeSchedules(vehicle.charge_schedules));
      const liveCharge = stringifyWithTimestamps(normalizeChargeSchedules(charge_schedules));
      if (!equalChargeSchedules(vehicle.charge_schedules, charge_schedules)) {
        logVehicle(LogLevel.Warning, vehicle, `${vehicle.vin} cached charge schedules differ from live vehicle schedules (${reason}) cached=${cachedCharge} live=${liveCharge}`);
      }
      const cachedPrecon = stringifyWithTimestamps(normalizePreconditionSchedules(vehicle.precondition_schedules));
      const livePrecon = stringifyWithTimestamps(normalizePreconditionSchedules(precondition_schedules));
      if (!equalPreconditionSchedules(vehicle.precondition_schedules, precondition_schedules)) {
        logVehicle(LogLevel.Warning, vehicle, `${vehicle.vin} cached preconditioning schedules differ from live vehicle schedules (${reason}) cached=${cachedPrecon} live=${livePrecon}`);
      }
    }
    vehicle.charge_schedules = charge_schedules;
    vehicle.precondition_schedules = precondition_schedules;
    vehicle.lastScheduleSyncAt = Date.now();
  }
  public async vehicleWork(job: TeslaAgentJob, vehicle: VehicleEntry) {
    assert(vehicle.dbData !== null, "vehicle.dbData is null");
    try {
      const now = Date.now();
      const forceImmediateScheduleCheck = (vehicle.lastPlugInAt || 0) > (vehicle.lastImmediateScheduleCheckAt || 0);
      const auditIntervalMs = this.scheduleAuditIntervalMs(now);

      // 24 minutes without a single update, I consider the vehicle offline
      if (vehicle.isOnline && vehicle.tsUpdate < Date.now() - 24 * 60e3) {
        logVehicle(LogLevel.Info, vehicle, `Vehicle ${vehicle.vin} is offline (stale connection)`);
        vehicle.network = {};
        await this.updateOnlineStatus(vehicle);
      }

      // Poll schedules when we first see the vehicle online, then audit them periodically.
      if (vehicle.isOnline && (vehicle.charge_schedules === undefined || vehicle.precondition_schedules === undefined)) {
        const lastAttemptAt = vehicle.lastScheduleSyncAttemptAt;
        if (!forceImmediateScheduleCheck
          && lastAttemptAt !== undefined
          && lastAttemptAt + TeslaAgent.SCHEDULE_SYNC_RETRY_MS > now) {
          return;
        }
        await this.refreshVehicleSchedules(job, vehicle, "initial load");
      } else if (auditIntervalMs !== null
        && vehicle.isOnline
        && (!vehicle.lastScheduleSyncAt || vehicle.lastScheduleSyncAt < now - auditIntervalMs)) {
        await this.refreshVehicleSchedules(job, vehicle, "periodic audit", true);
      }

      const locationID = vehicle.dbData.chargePlanLocationID || vehicle.dbData.locationID;
      if (locationID) {
        const location = await this.getLocation(locationID);
        const distance = vehicle.telemetryData.Location
          ? geoDistance(
            location.geoLocation.latitude, location.geoLocation.longitude,
            vehicle.telemetryData.Location.latitude, vehicle.telemetryData.Location.longitude
          )
          : null;
        await this.handleSchedules(job, vehicle, location, distance, forceImmediateScheduleCheck);
      } else {
        await this.updateScheduleSyncIssue(vehicle, null);
      }
    } catch (err) {
      // Check if err is RestClientError
      if (err instanceof RestClientError) {
        if (err.code === 408) { // Request timeout
          logVehicle(LogLevel.Warning, vehicle, `Request timeout for ${vehicle.vin} (${err.message})`);
          vehicle.network = {};
          await this.updateOnlineStatus(vehicle);
          return;
        }
      }
      logVehicle(LogLevel.Error, vehicle, `vehicleWork error for ${vehicle.vin}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  public async handleSchedules(
    job: TeslaAgentJob,
    vehicle: VehicleEntry,
    location: GQLLocationFragment,
    distanceToLocationM: number | null,
    forceImmediateScheduleCheck: boolean
  ) {
    assert(vehicle.dbData !== null, "vehicle.dbData is null");
    assert(vehicle.telemetryData !== null, "vehicle.telemetryData is null");
    let wantedSoc: number | undefined;
    const now = Date.now();
    if (forceImmediateScheduleCheck) {
      vehicle.lastImmediateScheduleCheckAt = now;
    }

    // Handle charge plans
    const chargePlan: (NumericChargePlan & { comment?: string })[] = (vehicle.dbData.chargePlan || [])
      .filter((p) => {
        // Skip disabled plans
        if (p.chargeType === GQLChargeType.Disable) return false;
        // Skip plans that have already ended
        if (p.chargeStop && numericStopTime(p.chargeStop) < now) return false;
        // Ignore plans that are 30 hours in the future
        if (p.chargeStart && numericStartTime(p.chargeStart) > now + 30 * 60 * 60e3) return false;
        return true;
      })
      // Convert to numeric charge plans with start and stop times rounded to 15 minutes
      .map((p): NumericChargePlan => {
        if (p.level !== undefined && (wantedSoc === undefined || wantedSoc < p.level)) {
          wantedSoc = p.level;
        }
        return {
          chargeStart: this.quantizeTime(p.chargeStart, Math.floor),
          chargeStop: this.quantizeTime(p.chargeStop, Math.ceil)
        };
      }
      // Sort by start time
      ).sort((a, b) => compareStartStopTimes(a.chargeStart, a.chargeStop, b.chargeStart, b.chargeStop));

    // Check if we are inside the first charge plan
    const insideFirstCharge = chargePlan.length > 0 && now >= numericStartTime(chargePlan[0].chargeStart);
    const firstChargeStart = chargePlan.length > 0 ? numericStartTime(chargePlan[0].chargeStart) : Infinity;

    if (vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateStopped && insideFirstCharge) {
      // We are inside the first charge, but it is not charging, so we back-date the start time by at least 10 minutes
      chargePlan[0].chargeStart = this.quantizeTime(now - 10 * 60e3, Math.floor);

    } else if (vehicle.telemetryData.Soc && vehicle.telemetryData.ChargeLimitSoc && vehicle.telemetryData.Soc > vehicle.telemetryData.ChargeLimitSoc - 1.5) {
      // SOC is above or close to the limit, so we don't need schedule logic
      logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} skipping charge blocker logic because SOC is above or close to the limit`);

    } else if (vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateCharging && !insideFirstCharge) {
      const nextFullSegmentEnd = this.quantizeTime(now, Math.ceil)! + TeslaAgent.CHARGE_SCHEDULE_QUANTUM_MS;
      if (firstChargeStart < nextFullSegmentEnd) {
        logVehicle(
          LogLevel.Trace,
          vehicle,
          `${vehicle.vin} keeping ongoing charge because the next planned restart is before ${new Date(nextFullSegmentEnd).toISOString()}`
        );
      } else {
        // We are charging outside the current plan. Only stop if the next planned restart is not
        // before the end of the next full tariff segment; otherwise keep charging to avoid short
        // stop/start churn while still respecting tariff-interval fidelity.
        chargePlan.unshift({
          chargeStart: null, chargeStop: this.quantizeTime(now - 10 * 60e3, Math.floor),
          comment: "completed schedule to stop ongoing charging"
        });
      }
    } else if (vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected && firstChargeStart > now + 17 * 60 * 60e3) {
      // We are disconnected, and the first charge is more than 17 hours in the future, so we need a charge blocker
      chargePlan.unshift({
        chargeStart: null, chargeStop: this.quantizeTime(now - 10 * 60e3, Math.floor),
        comment: "completed schedule to prevent charging when plugging in"
      });
    }

    // Build requested schedule
    const requestedSchedule = chargePlan
      // Remove open ended plans, cause Tesla does not support them
      .filter((p) => p.chargeStart !== null || p.chargeStop !== null)
      // Consolidate plans that are overlapping or edge-to-edge
      .reduce((acc, p) => {
        if (acc.length > 0) {
          const last = acc[acc.length - 1];
          if (compareStartTimes(p.chargeStart, last.chargeStop) <= 0) {
            // Overlapping or edge-to-edge, merge them
            last.chargeStop = p.chargeStop;
            return acc;
          }
        }
        acc.push(p);
        return acc;
      }, [] as (NumericChargePlan & { comment?: string })[]);
    logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} requested schedule: ${stringifyWithTimestamps(requestedSchedule)}`);

    const connected = Boolean(vehicle.dbData?.isConnected || this.isConnected(vehicle));
    if (!teslaShouldMaintainRemoteHomeSchedule(
      connected,
      location,
      distanceToLocationM,
      TeslaAgent.APPROACH_CHARGE_LOCATION_M
    )) {
      await this.updateScheduleSyncIssue(vehicle, null);
      logVehicle(
        LogLevel.Trace,
        vehicle,
        `${vehicle.vin} skipping home schedule maintenance while far from location (${Math.round((distanceToLocationM || 0) / 1e3)}km)`
      );
      return;
    }

    const canMutateSchedules = vehicle.isOnline
      || await this.tryEmergencyWakeForCharging(job, vehicle, requestedSchedule, wantedSoc);

    // Schedule reconciliation needs a live schedule view. After a restart, an offline vehicle may
    // only get that by emergency-waking first and refreshing schedules as part of that wake path.
    // If schedules are still unknown, do not invent a sync issue state; we only persist a flag
    // when we know the vehicle schedule is wrong.
    if (!vehicle.charge_schedules || !vehicle.precondition_schedules) {
      logVehicle(LogLevel.Trace, vehicle, `${vehicle.vin} skipping schedule reconciliation because live schedules are unknown`);
      return;
    }

    {
      const deferScheduleMutation = this.shouldDeferScheduleMutation(vehicle, requestedSchedule, now, location, distanceToLocationM);
      let didMutateSchedules = false;
      let hasInexactPurposeMatch = false;
      const freeScheduleIDs: number[] = [];
      const usedScheduleIDs = new Set<number>();
      const scheduleUpdates: (TeslaChargeSchedule & { comment: string })[] = [];

      // Convert all existing vehicle schedules to a format that makes sense
      const vehicleSchedules: { [id: number]: (NumericChargePlan & { scheduleID: number }) } = {};
      for (const s of Object.values(vehicle.charge_schedules)) {
        assert(s.id !== undefined, "Invalid schedule ID");
        // Filter out any schedule entry that is not ours
        if (!s.one_time || (s.id < TeslaScheduleIDs.First || s.id > TeslaScheduleIDs.Last)) continue;
        if (geoDistance(s.latitude, s.longitude, location.geoLocation.latitude, location.geoLocation.longitude) > 100) {
          // Not our location
          // Due to a bug in Tesla API, when we overwrite a schedule, it does not update the location,
          // so we need to delete it if the location does not match
          logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} deleting schedule ${s.id} because it does not match location`);
          logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.removeChargeSchedule(${s.id})`);
          await this.callTeslaAPI(job, teslaAPI.removeChargeSchedule, vehicle.vin, s.id);
          didMutateSchedules = true;
          delete vehicle.charge_schedules[s.id];
        } else {
          vehicleSchedules[s.id] = { ...this.convertFromTeslaSchedule(s, location), scheduleID: s.id };
        }
      }
      logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} requested schedules: ${stringifyWithTimestamps(requestedSchedule)}`);
      logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} existing schedules: ${stringifyWithTimestamps(vehicleSchedules)}`);

      const reversedVehicleSchedules = Object.values(vehicleSchedules).sort(
        (a, b) => compareStartStopTimes(b.chargeStart, b.chargeStop, a.chargeStart, a.chargeStop)
      );

      // Find out if we have a schedules that matches our request that we can use without modification
      // A modification is the same as creating a new schedule as we overwrite old IDs instead of deleting
      // overwrite = delete + create in one API call
      for (const r of [...requestedSchedule].reverse()) {
        for (const s of reversedVehicleSchedules) {
          if (usedScheduleIDs.has(s.scheduleID)) continue;
          if (!teslaScheduleServesRequestedPurpose(
            connected,
            vehicle.telemetryData.DetailedChargeState,
            s,
            r,
            now,
            location,
            distanceToLocationM,
            TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
            TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
          )) {
            continue;
          }
          logVehicle(
            LogLevel.Trace,
            vehicle,
            `${vehicle.vin} found purpose match for schedule ${s.scheduleID}: ${stringifyWithTimestamps(s)}`
          );
          if (!teslaScheduleMatchesExactly(s, r)) {
            hasInexactPurposeMatch = true;
            scheduleUpdates.push({
              ...this.convertToTeslaSchedule(r, location),
              id: s.scheduleID,
              enabled: true,
              comment: `adjusting existing schedule ${s.scheduleID}`
            });
          }
          r.scheduleID = s.scheduleID;
          usedScheduleIDs.add(s.scheduleID);
          break;
        }
        if (r.scheduleID === undefined) {
          // No matching schedule found, we need to create a new one
          logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} requires a new schedule that starts ${r.chargeStart ? `at ${new Date(r.chargeStart).toISOString()}` : "now"} and ends ${r.chargeStop ? `at ${new Date(r.chargeStop).toISOString()}` : "whenever"}`);
          scheduleUpdates.push({
            ...this.convertToTeslaSchedule(r, location),
            comment: "new schedule"
          });
        }
      }
      logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} schedule updates: ${stringifyWithTimestamps(scheduleUpdates)}`);
      const wantedSocLimit = teslaWantedSocLimit(wantedSoc);
      const issueKind = classifyChargingSetupSyncIssue(
        requestedSchedule,
        Object.values(vehicleSchedules),
        now,
        hasInexactPurposeMatch,
        wantedSocLimit,
        vehicle.telemetryData.ChargeLimitSoc,
        vehicle.telemetryData.Soc,
        connected
      );
      const scheduleMutationCooldownMs = teslaSchedulePurposeCadenceMs(
        connected,
        location,
        distanceToLocationM,
        TeslaAgent.LOCKED_IN_SCHEDULE_CADENCE_MS,
        TeslaAgent.FLUID_SCHEDULE_CADENCE_MS
      );
      const nextAllowedScheduleMutationAt = (vehicle.lastScheduleMutationAt || now) + scheduleMutationCooldownMs;
      const needsChargeLimitUpdate = connected
        && wantedSocLimit !== null
        && (vehicle.telemetryData.Soc ?? Number.POSITIVE_INFINITY) < wantedSocLimit
        && vehicle.telemetryData.ChargeLimitSoc !== undefined
        && vehicle.telemetryData.ChargeLimitSoc < wantedSocLimit
        && requestedSchedule.some((window) => numericStopTime(window.chargeStop) > now && numericStartTime(window.chargeStart) <= nextAllowedScheduleMutationAt);

      if (canMutateSchedules) {
        if (!forceImmediateScheduleCheck && deferScheduleMutation && scheduleUpdates.length > 0 && !needsChargeLimitUpdate) {
          await this.updateScheduleSyncIssue(
            vehicle,
            issueKind
              ? {
                kind: "drift",
                locationID: location.id,
                since: now,
              }
              : null
          );
          logVehicle(
            LogLevel.Debug,
            vehicle,
            `${vehicle.vin} deferring schedule rewrite for ${Math.ceil((nextAllowedScheduleMutationAt - now) / 60e3)}m while schedule purpose is still fluid`
          );
          return;
        }
        await this.updateScheduleSyncIssue(vehicle, null);
        // Handle preconditioning schedules
        {
          const autoHvac = vehicle.dbData.providerData && vehicle.dbData.providerData.auto_hvac === true;
          const scSchedule = autoHvac
            ? vehicle.dbData.schedule
              .filter((f) => f.type === GQLScheduleType.Trip && f.time && new Date(f.time).getTime() > now)
              .sort((a, b) => compareStartTimes(a.time, b.time))
            : [];
          let wantedPrecon: TeslaPreconditionSchedule | undefined;
          if (scSchedule.length > 0) {
            const departure = this.ConvertUTCtoLocationTime(location, new Date(scSchedule[0].time!));
            wantedPrecon = {
              id: TeslaScheduleIDs.Precondition,
              days_of_week: 1 << departure.getUTCDay(),
              enabled: true,
              latitude: location.geoLocation.latitude,
              longitude: location.geoLocation.longitude,
              precondition_time: (departure.getUTCHours() * 60 + departure.getUTCMinutes()),
              one_time: true,
            };
          }
          const existingPrecon = vehicle.precondition_schedules[TeslaScheduleIDs.Precondition];
          if (wantedPrecon) {
            const isSame = !!existingPrecon
              && wantedPrecon.precondition_time === existingPrecon.precondition_time
              && wantedPrecon.days_of_week === existingPrecon.days_of_week
              && geoDistance(wantedPrecon.latitude, wantedPrecon.longitude, existingPrecon.latitude, existingPrecon.longitude) < 100;
            if (isSame) {
              // No change
              logVehicle(LogLevel.Trace, vehicle, `${vehicle.vin} preconditioning schedule is up to date`);
            } else {
              logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} updating preconditioning schedule`);
              logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.addPreconditionSchedule`);
              await this.callTeslaAPI(job, teslaAPI.addPreconditionSchedule, vehicle.vin, wantedPrecon);
              didMutateSchedules = true;
              vehicle.precondition_schedules[TeslaScheduleIDs.Precondition] = wantedPrecon;
            }
          } else if (existingPrecon) {
            logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} deleting preconditioning schedule`);
            logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.removePreconditionSchedule`);
            await this.callTeslaAPI(job, teslaAPI.removePreconditionSchedule, vehicle.vin, TeslaScheduleIDs.Precondition);
            didMutateSchedules = true;
            delete vehicle.precondition_schedules[TeslaScheduleIDs.Precondition];
          }
        }

        // Add or update schedules
        {
          let findid = TeslaScheduleIDs.First;
          freeScheduleIDs.push(...Object.keys(vehicleSchedules).map((s) => parseInt(s)).filter((s) => !usedScheduleIDs.has(s)));
          for (const s of scheduleUpdates) {
            if (s.id === undefined) {
              if (freeScheduleIDs.length > 0) {
                s.id = freeScheduleIDs.shift();
              } else {
                for (; findid <= TeslaScheduleIDs.Last; findid++) {
                  if (!usedScheduleIDs.has(findid)) {
                    s.id = findid;
                    break;
                  }
                }
              }
            }
            if (s.id === undefined) {
              logVehicle(LogLevel.Warning, vehicle, `${vehicle.vin} ran out of schedule IDs`);
              break;
            }
            usedScheduleIDs.add(s.id);
            if (s.comment === "new schedule") {
              logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} setting schedule ${s.id}`);
            } else {
              logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} ${s.comment}`);
            }
            assert(usedScheduleIDs.has(s.id), "Invalid schedule ID");
            logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.addChargeSchedule(${s.id})`);
            await this.callTeslaAPI(job, teslaAPI.addChargeSchedule, vehicle.vin, s);
            didMutateSchedules = true;
            // Cache the newly set schedule with correct lat/long (only after successful API call)
            vehicle.charge_schedules[s.id] = s;
            logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} cached schedule ${s.id} @ [${s.latitude},${s.longitude}]`);
          }
        }

        // Remove any schedules that are not in use
        for (const s of Object.values(vehicleSchedules)) {
          if (!usedScheduleIDs.has(s.scheduleID)) {
            logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} deleting schedule ${s.scheduleID}`);
            // Log to database that we are deleting this schedule
            logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.removeChargeSchedule(${s.scheduleID})`);
            await this.callTeslaAPI(job, teslaAPI.removeChargeSchedule, vehicle.vin, s.scheduleID);
            didMutateSchedules = true;
            delete vehicle.charge_schedules[s.scheduleID];
          }
        }

        // Update SOC if needed
        if (this.isConnected(vehicle) && wantedSocLimit !== null) {
          if (vehicle.telemetryData.ChargeLimitSoc !== wantedSocLimit) {
            logVehicle(LogLevel.Debug, vehicle, `${vehicle.vin} setting charge limit to ${wantedSocLimit}%`);
            logVehicle(LogLevel.Trace, vehicle, `Calling TeslaAPI.setChargeLimit(${wantedSocLimit}%)`);
            await this.callTeslaAPI(job, teslaAPI.setChargeLimit, vehicle.vin, wantedSocLimit);
          }
        }
        if (this.scheduleAuditIntervalMs(now) !== null && didMutateSchedules) {
          await this.refreshVehicleSchedules(job, vehicle, "post-update audit", true);
        }
        if (didMutateSchedules) {
          vehicle.lastScheduleMutationAt = Date.now();
        }
      } else {
        await this.updateScheduleSyncIssue(
          vehicle,
          issueKind
            ? { kind: issueKind, locationID: location.id, since: now }
            : null
        );
      }
    }
  }

  public isConnected(vehicle: VehicleEntry): boolean {
    return Boolean(vehicle.telemetryData
      && vehicle.telemetryData.DetailedChargeState
      && vehicle.telemetryData.DetailedChargeState !== telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected
    );
  }

  public async updateOnlineStatus(vehicle: VehicleEntry) {
    assert(vehicle.vehicleUUID !== null, "vehicle.vehicleUUID is null");

    const update: UpdateVehicleParams = { id: vehicle.vehicleUUID, providerData: { network: {} } };
    // Compare vehicle.dbData.providerData.network with vehicle.network
    // 1. Any entry in vehicle.dbData.providerData.network not in vehicle.network is a disconnect, set it to null
    if (vehicle.dbData && vehicle.dbData.providerData && vehicle.dbData.providerData.network) {
      for (const connectionId of Object.keys(vehicle.dbData.providerData.network)) {
        if (!vehicle.network[connectionId]) {
          update.providerData.network[connectionId] = null;
        }
      }
    }

    // 2. Any entry in vehicle.network not in vehicle.dbData.providerData is a new connection
    for (const connectionId of Object.keys(vehicle.network)) {
      if (!vehicle.dbData || !vehicle.dbData.providerData || !vehicle.dbData.providerData.network
        || !vehicle.dbData.providerData.network[connectionId]) {
        update.providerData.network[connectionId] = vehicle.network[connectionId];
      }
    }
    // 3. If there are no changes, remove the network object
    if (Object.keys(update.providerData.network).length === 0) {
      delete update.providerData;
    }

    vehicle.isOnline = Object.keys(vehicle.network).length > 0;
    {
      const status = vehicle.isOnline
        ? `Online (${Object.values(vehicle.network).join(", ")})`
        : vehicle.isSleepy ? "Sleeping" : "Offline";

      if (vehicle.dbData && vehicle.dbData.status !== status) {
        update.status = status;
      }
    }
    if (Object.keys(update).length > 1) {
      logVehicle(LogLevel.Debug, vehicle, `Updating vehicle ${vehicle.vin}: ${JSON.stringify(update)}`);
      vehicle.dbData = await this.scClient.updateVehicle(update);
    }
  }

  public async telemetryConnectivityMessage(
    data: telemetryConnectivity.VehicleConnectivity
  ) {
    const vehicle = this.vehicleEntry(data.vin);
    logVehicle(
      LogLevel.Info,
      vehicle,
      `Tesla Telemetry connectivity ${data.vin} ${data.connectionId} ${data.networkInterface} ${telemetryConnectivity.ConnectivityEvent[data.status]}`
    );
    vehicle.tsUpdate = Date.now();

    if (data.status === telemetryConnectivity.ConnectivityEvent.DISCONNECTED) {
      delete vehicle.network[data.connectionId];
    } else if (data.status === telemetryConnectivity.ConnectivityEvent.CONNECTED) {
      vehicle.network[data.connectionId] = data.networkInterface;
    }
    this.requestServiceWork(vehicle, TeslaAgent.URGENT_SERVICE_INTERVAL_S, "connectivity change");
    if (vehicle.vehicleUUID) {
      await this.updateOnlineStatus(vehicle);
    }
  }

  public async telemetryDataMessage(vin: string, datum: telemetryData.Datum) {
    if (!datum.value) return;
    const key = datum.key;
    const value = datum.value && datum.value.value;
    const vehicle = this.vehicleEntry(vin);
    const previousDetailedChargeState = vehicle.telemetryData.DetailedChargeState;
    logVehicle(
      LogLevel.Trace,
      vehicle,
      `Telemetry data for ${vin}: ${telemetryData.Field[key]} = ${formatTelemetryValue(value)} (${value.case})`
    );
    vehicle.tsUpdate = Date.now();

    if (value.case === "invalid") {
      // Specia case for invalid values
      switch (key) {
        case telemetryData.Field.DetailedChargeState:
          vehicle.telemetryData.DetailedChargeState = telemetryData.DetailedChargeStateValue.DetailedChargeStateUnknown;
          break;
        case telemetryData.Field.HvacPower:
          vehicle.telemetryData.HvacPower = telemetryData.HvacPowerState.HvacPowerStateUnknown;
          break;
        case telemetryData.Field.HvacAutoMode:
          vehicle.telemetryData.HvacAutoMode = telemetryData.HvacAutoModeState.HvacAutoModeStateUnknown;
          break;
        case telemetryData.Field.ClimateKeeperMode:
          vehicle.telemetryData.ClimateKeeperMode = telemetryData.ClimateKeeperModeState.ClimateKeeperModeStateUnknown;
          break;
        case telemetryData.Field.Gear:
          vehicle.isSleepy = true;
          break;
      }
    } else {
      try {
        switch (key) {
          case telemetryData.Field.ChargeState:
          case telemetryData.Field.VehicleName:
          case telemetryData.Field.Trim:
          case telemetryData.Field.ExteriorColor:
          case telemetryData.Field.RoofColor:
          case telemetryData.Field.WheelType:
            assert(value.case === "stringValue", `Invalid ${key} value type ${value.case}`);
            (vehicle.telemetryData as any)[telemetryData.Field[key]] = value.value;
            break;
          case telemetryData.Field.FastChargerPresent:
          case telemetryData.Field.ChargeEnableRequest:
          case telemetryData.Field.DriverSeatOccupied:
          case telemetryData.Field.ChargePortDoorOpen:
          case telemetryData.Field.ScheduledChargingPending:
            assert(value.case === "booleanValue", `Invalid ${key} value type ${value.case}`);
            (vehicle.telemetryData as any)[telemetryData.Field[key]] = value.value;
            break;
          case telemetryData.Field.Soc:
          case telemetryData.Field.Odometer:
          case telemetryData.Field.OutsideTemp:
          case telemetryData.Field.InsideTemp:
          case telemetryData.Field.ModuleTempMin:
          case telemetryData.Field.ModuleTempMax:
          case telemetryData.Field.TimeToFullCharge:
          case telemetryData.Field.ChargeAmps:
          case telemetryData.Field.ChargeCurrentRequest:
          case telemetryData.Field.ChargeCurrentRequestMax:
          case telemetryData.Field.ChargeLimitSoc:
          case telemetryData.Field.ChargerPhases:
          case telemetryData.Field.ACChargingEnergyIn:
          case telemetryData.Field.ACChargingPower:
          case telemetryData.Field.DCChargingEnergyIn:
          case telemetryData.Field.DCChargingPower:
            (vehicle.telemetryData as any)[telemetryData.Field[key]] = mapTelemetryNumber(value);
            break;
          case telemetryData.Field.ScheduledChargingStartTime:
            assert(value.case === "longValue", `Invalid ScheduledChargingStartTime value type ${value.case}`);
            // Tesla API returns the time in seconds since epoch and not milliseconds, bigint is not needed here
            vehicle.telemetryData.ScheduledChargingStartTime = Number(value.value);
            break;
          case telemetryData.Field.Location:
            assert(value.case === "locationValue", `Invalid Location value type ${value.case}`);
            vehicle.telemetryData.Location = { latitude: value.value.latitude, longitude: value.value.longitude };
            break;
          case telemetryData.Field.HvacPower:
            assert(value.case === "hvacPowerValue", `Invalid HvacPower value type ${value.case}`);
            vehicle.telemetryData.HvacPower = value.value;
            break;
          case telemetryData.Field.DetailedChargeState:
            assert(value.case === "detailedChargeStateValue", `Invalid DetailedChargeState value type ${value.case}`);
            vehicle.telemetryData.DetailedChargeState = value.value;
            if (previousDetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected
              && value.value !== telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected) {
              vehicle.lastPlugInAt = Date.now();
            }
            break;
          case telemetryData.Field.HvacAutoMode:
            assert(value.case === "hvacAutoModeValue", `Invalid HvacAutoMode value type ${value.case}`);
            vehicle.telemetryData.HvacAutoMode = value.value;
            break;
          case telemetryData.Field.ClimateKeeperMode:
            assert(value.case === "climateKeeperModeValue", `Invalid ClimateKeeperMode value type ${value.case}`);
            vehicle.telemetryData.ClimateKeeperMode = value.value;
            break;
          case telemetryData.Field.SentryMode:
            assert(value.case === "sentryModeStateValue", `Invalid SentryMode value type ${value.case}`);
            vehicle.telemetryData.SentryMode = value.value;
            break;
          case telemetryData.Field.CarType:
            assert(value.case === "carTypeValue", `Invalid CarType value type ${value.case}`);
            vehicle.telemetryData.CarType = value.value;
            break;
          case telemetryData.Field.Gear:
            vehicle.isSleepy = false;
            assert(value.case === "shiftStateValue", `Invalid Gear value type ${value.case}`);
            vehicle.telemetryData.Gear = value.value;
            break;
          case telemetryData.Field.ScheduledChargingMode:
            assert(value.case === "scheduledChargingModeValue", `Invalid ScheduledChargingMode value type ${value.case}`);
            vehicle.telemetryData.ScheduledChargingMode = value.value;
            break;
          case telemetryData.Field.FastChargerType:
            assert(value.case === "fastChargerValue", `Invalid FastChargerType value type ${value.case}`);
            vehicle.telemetryData.FastChargerType = value.value;
            break;
          default:
          // TODO: Add this when we remove the top trace that logs all telemetry data
          //log(LogLevel.Trace, `Unhandled telemetry data for ${vin}: ${telemetryData.Field[key]} = ${value.value} (${value.case})`);
          //break;
        }
      } catch (err) {
        // We catch this here so that it doesn't crash the entire worker, leaving Kafka in a sad state
        logVehicle(
          LogLevel.Error,
          vehicle,
          `Failed to handle telemetry data for ${vin}: ${telemetryData.Field[key]} = ${formatTelemetryValue(value)} (${value.case})`
        );
        logVehicle(LogLevel.Error, vehicle, err);
        return;
      }
      // charger_phases seems to be reported wrong, or I simply don't understand and someone could explain it?
      // Tesla Wall Connector in Sweden reports 2 phases, 16 amps, and 230 volt = 2*16*230 = 7kW,
      // the correct number should be 11 kW on 3 phases (3*16*230).
      // I used the following formula to calculate the correct number of phases:
      // (charger_power * 1e3) / (charger_actual_current * charger_voltage)
    }

    if (this.isChargingState(vehicle.telemetryData.DetailedChargeState)) {
      vehicle.lastChargingAt = Date.now();
    }
    if (
      key === telemetryData.Field.DetailedChargeState
      || key === telemetryData.Field.ChargeState
      || key === telemetryData.Field.ChargeEnableRequest
      || key === telemetryData.Field.ScheduledChargingPending
      || key === telemetryData.Field.Location
    ) {
      this.requestServiceWork(vehicle, TeslaAgent.URGENT_SERVICE_INTERVAL_S, telemetryData.Field[key]);
    }

    if (vehicle.vehicleUUID) {
      if (vehicle.isUpdating) {
        logVehicle(LogLevel.Info, vehicle, `Vehicle ${vin} is already updating, waiting for it to finish`);
        assert(vehicle.updatePromise !== null, "updatePromise is null");
        await vehicle.updatePromise;
      }
      if (vehicle.updatePromise === null) {
        vehicle.updatePromise = (async () => {
          await delay(1000);
          vehicle.isUpdating = true;

          try {
            const innerPromises: Promise<any>[] = [];

            // Extract only changed telemetry data
            const telemetryDataUpdate = diffObjects(vehicle.telemetryData, vehicle.lastTelemetryData);
            vehicle.telemetryData = { ...vehicle.lastTelemetryData, ...vehicle.telemetryData };
            vehicle.lastTelemetryData = { ...vehicle.telemetryData };
            if (Object.keys(telemetryDataUpdate).length > 0) {
              assert(vehicle.vehicleUUID !== null, "vehicleUUID is null");

              const vehicleUpdate: UpdateVehicleParams = {
                id: vehicle.vehicleUUID,
                providerData: { telemetryData: telemetryDataUpdate },
              };

              // Map telemetry updates to vehicle data updates
              if (telemetryDataUpdate.Location !== undefined) {
                vehicle.vehicleDataInput.geoLocation = telemetryDataUpdate.Location;
              }
              if (telemetryDataUpdate.Soc !== undefined) {
                vehicle.vehicleDataInput.batteryLevel = Math.round(telemetryDataUpdate.Soc);
              }
              if (telemetryDataUpdate.Odometer !== undefined) {
                vehicle.vehicleDataInput.odometer = Math.round(telemetryDataUpdate.Odometer * 1609.344); // 1 mile = 1.609344 km
              }
              if (telemetryDataUpdate.OutsideTemp !== undefined) {
                vehicle.vehicleDataInput.outsideTemperature = telemetryDataUpdate.OutsideTemp;
              }
              if (telemetryDataUpdate.InsideTemp !== undefined) {
                vehicle.vehicleDataInput.insideTemperature = telemetryDataUpdate.InsideTemp;
              }
              if (telemetryDataUpdate.TimeToFullCharge !== undefined) {
                vehicle.vehicleDataInput.estimatedTimeLeft = Math.round(telemetryDataUpdate.TimeToFullCharge * 60); // Convert to minutes
              }
              if (telemetryDataUpdate.VehicleName !== undefined) {
                vehicleUpdate.name = telemetryDataUpdate.VehicleName;
              }
              if (telemetryDataUpdate.HvacPower !== undefined) {
                vehicle.vehicleDataInput.climateControl = (telemetryDataUpdate.HvacPower === telemetryData.HvacPowerState.HvacPowerStateOn);
              }
              if (telemetryDataUpdate.Gear !== undefined) {
                vehicle.vehicleDataInput.isDriving = (
                  telemetryDataUpdate.Gear === telemetryData.ShiftState.ShiftStateD
                  || telemetryDataUpdate.Gear === telemetryData.ShiftState.ShiftStateR
                  || telemetryDataUpdate.Gear === telemetryData.ShiftState.ShiftStateN);
              }
              if (telemetryDataUpdate.ACChargingEnergyIn !== undefined) {
                vehicle.vehicleDataInput.energyUsed = telemetryDataUpdate.ACChargingEnergyIn;
              }
              if (telemetryDataUpdate.ACChargingPower !== undefined) {
                vehicle.vehicleDataInput.powerUse = telemetryDataUpdate.ACChargingPower;
              }
              if (telemetryDataUpdate.DCChargingEnergyIn !== undefined) {
                vehicle.vehicleDataInput.energyAdded = telemetryDataUpdate.DCChargingEnergyIn;
              }
              if (telemetryDataUpdate.ChargeState !== undefined
                || telemetryDataUpdate.DetailedChargeState !== undefined) {
                const status =
                  vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateCharging ? "Charging" :
                  vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateComplete ? "Charging Complete" :
                  vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected ? "Charger Disconnected" :
                  vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateNoPower ? "Charger Not Powered" :
                  vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateStarting ? "Charging Starting" :
                  vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateStopped ? "Charging Stopped" : "";
                if (status) {
                  vehicleUpdate.status = `${status}${vehicle.telemetryData.ChargeState === "" ||
                    vehicle.telemetryData.ChargeState === "Idle" ||
                    vehicle.telemetryData.ChargeState === "Enable" ? "" : ` (${vehicle.telemetryData.ChargeState})`}`;
                }
              }
              if (vehicle.telemetryData.DetailedChargeState !== undefined
                && vehicle.telemetryData.DetailedChargeState !== telemetryData.DetailedChargeStateValue.DetailedChargeStateUnknown) {
                const isConnected = vehicle.telemetryData.DetailedChargeState !== telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected;
                vehicle.vehicleDataInput.connectedCharger = (isConnected ? vehicle.telemetryData.FastChargerPresent ? GQLChargeConnection.DC : GQLChargeConnection.AC : null);
              }

              if (vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateCharging) {
                vehicle.vehicleDataInput.chargingTo = Math.round(vehicle.telemetryData.ChargeLimitSoc || 90);
              } else {
                vehicle.vehicleDataInput.chargingTo = null;
              }
              logVehicle(LogLevel.Debug, vehicle, `Updating vehicle ${vehicle.vin} with ${JSON.stringify(vehicleUpdate)}`);
              innerPromises.push((async () => {
                vehicle.dbData = await this.scClient.updateVehicle(vehicleUpdate);
              })());
            }

            const vehicleDataUpdate = diffObjects(vehicle.vehicleDataInput, vehicle.lastVehicleDataInput);
            vehicle.vehicleDataInput = { ...vehicle.lastVehicleDataInput, ...vehicle.vehicleDataInput };
            vehicle.lastVehicleDataInput = { ...vehicle.vehicleDataInput };
            if (Object.keys(vehicleDataUpdate).length > 0) {
              assert(vehicle.vehicleUUID !== null, "vehicleUUID is null");

              logVehicle(LogLevel.Debug, vehicle, `Updating vehicle data ${vehicle.vin} with ${JSON.stringify(vehicleDataUpdate)}`);
              innerPromises.push(this.scClient.updateVehicleData({
                id: vehicle.vehicleUUID,
                ...vehicleDataUpdate,
              }));
            }

            await Promise.all(innerPromises);
          } catch (err) {
            logVehicle(LogLevel.Error, vehicle, `Error in updatePromise: ${err}`);
          } finally {
            vehicle.isUpdating = false;
            vehicle.updatePromise = null;
          }
        })();
      }
    }
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new TeslaAgent(scClient),
};
export default agent;
