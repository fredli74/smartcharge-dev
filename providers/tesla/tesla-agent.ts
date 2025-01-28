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
  numericStopTime,
  numericStartTime,
  diffObjects,
  delay,
  compareStartStopTimes,
  compareStopTimes,
  geoDistance,
} from "@shared/utils.js";
import { GQLLocationFragment, SCClient, UpdateVehicleParams } from "@shared/sc-client.js";
import config from "./tesla-config.js";
import teslaAPI, { TeslaAPI, TeslaChargeSchedule, TeslaPreconditionSchedule, TeslaScheduleTimeToDate, TeslaTelemetryConfig } from "./tesla-api.js";
import { AgentJob, AbstractAgent, IProviderAgent } from "@providers/provider-agent.js";
import provider, { TeslaServiceData, TeslaProviderMutates, TeslaProviderQueries, TeslaToken } from "./index.js";
import { GQLVehicle, GQLUpdateVehicleDataInput, GQLChargeConnection, GQLChargeType, GQLGeoLocation, GQLScheduleType } from "@shared/sc-schema.js";
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
  TimeToFullCharge: number;

  HvacPower: telemetryData.HvacPowerState;
  Gear: telemetryData.ShiftState;
  FastChargerPresent: boolean;
  FastChargerType: string;
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
  ScheduledDepartureTime: string;

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
  resend_interval_seconds? : number,
}; };
const telemetryFields: TelemetryFields = {
  Location: { interval_seconds: 60, minimum_delta: 0.00001 },
  Soc: { interval_seconds: 60, minimum_delta: 0.01 },
  Odometer: { interval_seconds: 15, minimum_delta: 0.01 },
  OutsideTemp: { interval_seconds: 60, minimum_delta: 0.5 },
  InsideTemp: { interval_seconds: 30, minimum_delta: 0.5 },
  TimeToFullCharge: { interval_seconds: 10, minimum_delta: 0.01 },

  VehicleName: { interval_seconds: 60 },

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
  ChargerVoltage: { interval_seconds: 5, minimum_delta: 1.5 },
  ACChargingEnergyIn: { interval_seconds: 10, minimum_delta: 0.001 },
  ACChargingPower: { interval_seconds: 10, minimum_delta: 0.5 },
  DCChargingEnergyIn: { interval_seconds: 10, minimum_delta: 0.001 },
  DCChargingPower: { interval_seconds: 10, minimum_delta: 0.5 },
  ScheduledChargingMode: { interval_seconds: 60 },
  ScheduledChargingStartTime: { interval_seconds: 60 },
  ScheduledChargingPending: { interval_seconds: 60 },
  ScheduledDepartureTime: { interval_seconds: 60 },

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

  charge_schedules?: { [id: number]: TeslaChargeSchedule }; // Cached charge schedules
  precondition_schedules?: { [id: number]: TeslaPreconditionSchedule }; // Cached precondition schedules
}

interface TeslaAgentState {
  [vehicleUUID: string]: string;  // vehicleUUID -> vin
}
interface TeslaAgentJob extends AgentJob {
  serviceData: TeslaServiceData;
  mapped: number;
  state: TeslaAgentState;
}

function mapTelemetryNumber(v: telemetryData.Value["value"]): number {
  switch (v.case) {
    case "stringValue": case "intValue": case "floatValue": case "doubleValue":
      return +v.value;
    default:
      log(LogLevel.Warning, `Tesla Telmetry invalid number value: ${v} (${v.case})`);
      return NaN;
  }
}

const TeslaScheduleIDs = {
  Block: 197400,
  First: 197401,
  Last: 197498,
  Precondition: 197499,
};

export class TeslaAgent extends AbstractAgent {
  public name: string = provider.name;
  public kafkaClient: Kafka;
  public kafkaConsumer: Consumer;
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
          log(LogLevel.Error, `Tesla Telmetry message value is null`);
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
            log(LogLevel.Error, `Tesla Telmetry error ${error.name} (${JSON.stringify(error.tags)}): ${error.body}`);
          }
        } else {
          log(LogLevel.Error, `Unknown Tesla Telmetry topic: ${topic}`);
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
    log(LogLevel.Debug, `Updated token for ${job.serviceID} to ${token.access_token}`);
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
    await this.maintainToken(job);
    return fn.apply(teslaAPI, [...args, job.serviceData.token]);
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

  public async serviceWork(job: TeslaAgentJob) {
    job.interval = 60;

    if (job.serviceData.invalid_token) {
      log(LogLevel.Trace, `Service ${job.serviceID} has an invalid token, skipping work`);
      return;
    }

    const clearTelemetryConfigFor = [];
    const setTelemetryConfigFor = [];

    // Map service to vehicles
    if (!job.mapped || (job.serviceData.updated && job.mapped < job.serviceData.updated)) {
      const unmapped = { ...job.state };
      const list = await this.scClient.providerQuery("tesla", {
        query: TeslaProviderQueries.Vehicles,
        service_uuid: job.serviceID,
      });
      for (const v of list) {
        if (v.vehicle_uuid) {
          job.state[v.vehicle_uuid] = v.vin;
          log(LogLevel.Debug, `Service ${job.serviceID} found vehicle ${v.vin} (${v.vehicle_uuid})`);
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
        log(LogLevel.Debug, `Service ${job.serviceID} unmapping vehicle ${vin} (no longer found)`);
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

        const t = data.providerData.telemetryData;
        const d = {
          id: uuid,
          geoLocation: data.geoLocation,
          batteryLevel: data.batteryLevel,
          odometer: data.odometer,
          outsideTemperature: data.outsideTemperature,
          insideTemperature: data.insideTemperature,
          climateControl: data.climateControl,
          isDriving: data.isDriving,
          connectedCharger: (data.isConnected ? t.FastChargerPresent ? GQLChargeConnection.DC : GQLChargeConnection.AC : null),
          chargingTo: data.chargingTo,
          estimatedTimeLeft: data.estimatedTimeLeft,
          powerUse: t.ACChargingPower || null,
          energyUsed: t.ACChargingEnergyIn || null,
          energyAdded: t.DCChargingEnergyIn || null,
        };
        vehicle.telemetryData = { ...t, ...vehicle.telemetryData };
        vehicle.lastTelemetryData = { ...t };
        vehicle.vehicleDataInput = { ...d, ...vehicle.vehicleDataInput };
        vehicle.lastVehicleDataInput = { ...d };
        vehicle.network = { ...data.providerData.network, ...vehicle.network };
        await this.updateOnlineStatus(vehicle);
      } else {
        vehicle.dbData = data;
        // Do not update vehicleDataInput or telemetryData here, because we might be in the middle of an update
      }

      assert(vehicle !== undefined, "vehicle is undefined");

      // Handle telemetry config
      const telemetryConfig =
        vehicle.telemetryConfig ? vehicle.telemetryConfig :
        (await this.callTeslaAPI(job, teslaAPI.getFleetTelemetryConfig, vehicle.vin)).response;
      const telemetryExpires = telemetryConfig.config && telemetryConfig.config.exp ? telemetryConfig.config.exp : 0;

      if (vehicle.dbData.providerData.disabled) {
        if (telemetryConfig.config) {
          log(LogLevel.Info, `Vehicle ${vehicle.vin} is disabled, but has telemetry config, deleting`);
          clearTelemetryConfigFor.push(vehicle.vin);
          vehicle.telemetryConfig = null; // re-trigger a config read
          continue;
        }
      } else if (!telemetryConfig.config) {
        log(LogLevel.Info, `No telemetry config for ${vehicle.vin}, creating`);
        setTelemetryConfigFor.push(vehicle.vin);
        vehicle.telemetryConfig = null; // re-trigger a config read
        continue;
      } else if (telemetryExpires < Date.now() / 1e3) {
        log(LogLevel.Info, `Telemetry config for ${vehicle.vin} expired, refreshing`);
        setTelemetryConfigFor.push(vehicle.vin);
        vehicle.telemetryConfig = null; // re-trigger a config read
        continue;
      } else {
        // From here we consider the telemetry config to be working so we can handle vehicle commands
        if (telemetryExpires < Date.now() / 1e3 + 60 * 60 * 24) {
          log(LogLevel.Info, `Telemetry config for ${vehicle.vin} expires soon, refreshing`);
          setTelemetryConfigFor.push(vehicle.vin);
          vehicle.telemetryConfig = null;
        } else {
          vehicle.telemetryConfig = telemetryConfig;
        }

        waitFor.push(this.vehicleWork(job, vehicle));
      }
    }

    for (const vin of clearTelemetryConfigFor) {
      log(LogLevel.Info, `Deleting telemetry config for ${vin}`);
      waitFor.push(this.callTeslaAPI(job, teslaAPI.deleteFleetTelemetryConfig, vin));
    }
    if (setTelemetryConfigFor.length > 0) {
      log(LogLevel.Info, `Creating telemetry config for ${setTelemetryConfigFor.join(", ")}`);
      const telemetry = (await this.callTeslaAPI(job, teslaAPI.createFleetTelemetryConfig, {
        vins: setTelemetryConfigFor,
        config: {
          hostname: config.TESLA_TELEMETRY_HOST,
          port: parseInt(config.TESLA_TELEMETRY_PORT),
          ca: config.TESLA_TELEMETRY_CA.replace(/\\n/g, "\n"),
          fields: telemetryFields,
          prefer_typed: true,
          exp: Math.trunc(Date.now() / 1e3 + 60 * 60 * 24 * 7), // 7 days
        },
      } as TeslaTelemetryConfig)).response;
      log(LogLevel.Debug, `Telemetry successfully created for ${telemetry.updated_vehicles} vehicles`);
      if (telemetry.skipped_vehicles) {
        log(LogLevel.Debug, `Skipped vehicles: ${JSON.stringify(telemetry)}`);
        if (telemetry.skipped_vehicles.missing_key) {
          for (const vin of telemetry.skipped_vehicles.missing_key) {
            const v = this.vehicles[vin];
            if (v.vehicleUUID) {
              log(LogLevel.Warning, `Missing key for ${vin} (${v.vehicleUUID})`);
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
              log(LogLevel.Warning, `Unsupported hardware for ${vin} (${v.vehicleUUID})`);
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
              log(LogLevel.Warning, `Unsupported firmware for ${vin} (${v.vehicleUUID})`);
              v.dbData = await this.scClient.updateVehicle({
                id: v.vehicleUUID,
                status: "Unsupported firmware",
                providerData: { error: "Unsupported firmware", disabled: true },
              });
            }
          }
        }
      }
    } else {
      job.interval = 5 * 60; // Poll every 5 minutes
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
  public async vehicleWork(job: TeslaAgentJob, vehicle: VehicleEntry) {
    assert(vehicle.dbData !== null, "vehicle.dbData is null");
    try {
      if (vehicle.isOnline) {
        if (vehicle.tsUpdate < Date.now() - 24 * 60 * 1e3) {
          log(LogLevel.Info, `Vehicle ${vehicle.vin} is offline (stale connection)`);
          vehicle.network = {};
          await this.updateOnlineStatus(vehicle);
        } else if (vehicle.charge_schedules === undefined || vehicle.precondition_schedules === undefined) {
          const schedules = (await this.callTeslaAPI(job, teslaAPI.getVehicleSchedules, vehicle.vin)).response;
          // Map charge_schedule_data.charge_schedules to { [id: number]: TeslaChargeSchedule }
          vehicle.charge_schedules = {};
          for (const s of schedules.charge_schedule_data.charge_schedules) {
            vehicle.charge_schedules[s.id] = s;
          }
          vehicle.precondition_schedules = {};
          for (const s of schedules.preconditioning_schedule_data.precondition_schedules) {
            vehicle.precondition_schedules[s.id] = s;
          }
        }
      }

      if (vehicle.charge_schedules && vehicle.precondition_schedules) {
        const scheduleUpdates: (TeslaChargeSchedule & { comment:string })[] = [];
        const removeScheduleIDs: number[] = [];
        let preconditionSchedule: TeslaPreconditionSchedule | undefined = undefined;
        let wantedSoc: number | undefined = undefined;

        if (vehicle.dbData.chargePlan && vehicle.dbData.chargePlanLocationID) {
          const location = await this.getLocation(vehicle.dbData.chargePlanLocationID);
          const chargePlan: NumericChargePlan[] = vehicle.dbData.chargePlan
            .filter((p) => p.chargeType !== GQLChargeType.Disable && (p.chargeStart || p.chargeStop))
            .sort((a, b) => compareStartStopTimes(a.chargeStart, a.chargeStop, b.chargeStart, b.chargeStop))
            .reduce((acc, p) => {
              assert(vehicle.dbData !== null, "vehicle.dbData is null");
              if (wantedSoc === undefined && p.level) {
                wantedSoc = p.level
              }
              if (p.chargeStop && numericStopTime(p.chargeStop) < Date.now()) {
                return acc; // Skip plans that have already ended
              }
              if (acc.length > 0) {
                const last = acc[acc.length - 1];
                // If less than 5 minutes between plans, consolidate
                if (numericStartTime(p.chargeStart) - numericStopTime(last.chargeStop) < 5 * 60e3) {
                  last.chargeStop = p.chargeStop ? new Date(p.chargeStop).getTime() : null;
                  return acc;
                }
              }
              acc.push({
                chargeType: p.chargeType,
                chargeStart: p.chargeStart ? new Date(p.chargeStart).getTime() : null,
                chargeStop: p.chargeStop ? new Date(p.chargeStop).getTime() : null,
              });
              return acc;
            }, [] as NumericChargePlan[]);

          // Convert all existing vehicle schedules to a format that makes sense
          const vehicleSchedules: { [id: number]: (NumericChargePlan & { scheduleID: number }) } = {};
          for (const s of Object.values(vehicle.charge_schedules)) {
            assert(s.id !== undefined, "Invalid schedule ID");
            // Filter out any schedule entry that is not ours
            if (!s.one_time || (s.id < 197400 || s.id > 197498)) continue;
            if (Math.abs(s.latitude - location.geoLocation.latitude) > 1e-4 // 11 meters
              || Math.abs(s.longitude - location.geoLocation.longitude) > 1e-4) { // 11 meters
              // Not our location
              log(LogLevel.Debug, `${vehicle.vin} skipping schedule ${s.id} because of location mismatch`);
              vehicleSchedules[s.id] = { chargeStart: null, chargeStop: null, scheduleID: s.id };
            } else {
              vehicleSchedules[s.id] = { ...this.convertFromTeslaSchedule(s, location), scheduleID: s.id };
            }
          }

          log(LogLevel.Debug, `${vehicle.vin} existing schedules: ${JSON.stringify(vehicleSchedules)}`);
          log(LogLevel.Debug, `${vehicle.vin} charge plan: ${JSON.stringify(chargePlan)}`);

          const firstCharge = chargePlan.length > 0 ? chargePlan[0] : null;
          const lastCharge = chargePlan.length > 0 ? chargePlan[chargePlan.length - 1] : null;

          // Tesla vehicles will only care about schedules that are 18 hours in the future or 6 hours in the past
          // It will default to charging, and we want it the other way around, so we use a charge blocker
          let needBlocker = false;

          // Always make the last charge open-ended if level is set ok
          if (lastCharge && wantedSoc && wantedSoc >= parseInt(config.LOWEST_POSSIBLE_CHARGETO)) {
            lastCharge.chargeStop = null;
          }

          // Are we inside the first charge?
          const insideFirstCharge = firstCharge && Date.now() >= numericStartTime(firstCharge.chargeStart) && Date.now() < numericStopTime(firstCharge.chargeStop);
          if (insideFirstCharge && vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateStopped) {
            // We are inside the first charge, but it is not charging, so we back-date the start time by 15 minutes
            firstCharge.chargeStart = Date.now() - 15 * 60e3;
          } else if (firstCharge && Date.now() < numericStartTime(firstCharge.chargeStart) && vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateCharging) {
            // We are before the first charge, but it is charging, so we need to add a charge blocker
            needBlocker = true;
          } else if (
            vehicle.telemetryData.DetailedChargeState === telemetryData.DetailedChargeStateValue.DetailedChargeStateDisconnected
            && (!firstCharge || numericStartTime(firstCharge.chargeStart) > Date.now() + 17 * 60 * 60e3)
            && vehicle.telemetryData.Location
            && geoDistance(
              location.geoLocation.latitude, location.geoLocation.longitude,
              vehicle.telemetryData.Location.latitude, vehicle.telemetryData.Location.longitude
            ) < 10e3 // 5 km
          ) {
            // We are not connected, we're more than 17 hours in the future, and we are close to the location, so we need a charge blocker
            needBlocker = true;
          }
          
          if (firstCharge && firstCharge.chargeStart === null && firstCharge.chargeStop === null) {
            // Open-ended first charge, do not set any schedules at all
          } else {
            const usedScheduleIDs = new Set<number>();
            // Compare existing vehicle schedules with charge plan
            for (const p of chargePlan) {
              assert(p.chargeStart || p.chargeStop, "Invalid charge plan");
              const wantedStart = p.chargeStart ? Math.floor(p.chargeStart / (15 * 60e3)) * 15 * 60e3 : null;
              const wantedStop = p.chargeStop ? Math.ceil(p.chargeStop / (15 * 60e3)) * 15 * 60e3 : null;
              for (const s of Object.values(vehicleSchedules).sort(
                // Sort them in reverse order so we can update the firstCharge last
                (a, b) => compareStartStopTimes(b.chargeStart, b.chargeStop, a.chargeStart, a.chargeStop)
              )) {
                if (s.chargeStart === null && s.chargeStop === null) {
                  // This is a pointless schedule, we should skip it here so it gets removed later
                  continue;
                }
                if (s.scheduleID === TeslaScheduleIDs.Block) {
                  // This is a charge blocker, it should not be reused as a schedule because it could be overwritten
                  continue;
                }

                // Are we inside this schedule?
                if (Date.now() >= numericStartTime(s.chargeStart) && Date.now() < numericStopTime(s.chargeStop)) {
                  // Adopt it
                  p.scheduleID = s.scheduleID;
                  let whatChanged: string | undefined = undefined;
                  if (!insideFirstCharge && s.chargeStart !== wantedStart) {
                    log(LogLevel.Info, `${vehicle.vin} updating schedule ${s.scheduleID} to start at ${wantedStart ? new Date(wantedStart).toISOString() : "now"} (was ${s.chargeStart ? new Date(s.chargeStart).toISOString() : "now"})`);
                    s.chargeStart = wantedStart;
                    whatChanged = "adjusted schedule start time"; 
                  }
                  if (s.chargeStop !== wantedStop) {
                    log(LogLevel.Info, `${vehicle.vin} updating schedule ${s.scheduleID} to end at ${wantedStop ? new Date(wantedStop).toISOString() : "never"} (was ${s.chargeStop ? new Date(s.chargeStop).toISOString() : "never"})`);
                    s.chargeStop = wantedStop;
                    whatChanged = "adjusted schedule end time";
                  }
                  if (whatChanged) {
                    scheduleUpdates.push({ ...this.convertToTeslaSchedule(s, location), comment: whatChanged });
                  }
                  usedScheduleIDs.add(s.scheduleID);
                  delete vehicleSchedules[s.scheduleID]; // We adopted this schedule
                  break;
                } else if (s.chargeStart === wantedStart && s.chargeStop === wantedStop) {
                  // We already have this schedule, just adopt it
                  p.scheduleID = s.scheduleID;
                  usedScheduleIDs.add(s.scheduleID);
                  delete vehicleSchedules[s.scheduleID]; // We adopted this schedule
                  break;
                }
              }
              if (p.scheduleID === undefined) {
                log(LogLevel.Info, `${vehicle.vin} creating new schedule to start at ${p.chargeStart ? new Date(p.chargeStart).toISOString() : "now"} and end at ${p.chargeStop ? new Date(p.chargeStop).toISOString() : "whenever"}`);
                scheduleUpdates.push({
                  ...this.convertToTeslaSchedule({ chargeStart: wantedStart, chargeStop: wantedStop }, location),
                  comment: "new schedule"
                });
              }
            }
          
            // Fill in missing schedule IDs
            {
              let findid = TeslaScheduleIDs.First;
              const freeIDs = Object.keys(vehicleSchedules).map(id => parseInt(id)).filter(id => id !== TeslaScheduleIDs.Block);
              for (const s of scheduleUpdates) {
                if (s.days_of_week === 0) {
                  // This is an invalid (open-ended schedule), it should not be set, just treated differently
                } else if (s.id === undefined) {
                  if (freeIDs.length > 0) {
                    // hijack an existing schedule ID
                    s.id = freeIDs.shift()!;
                    usedScheduleIDs.add(s.id);
                    delete vehicleSchedules[s.id];
                  } else {
                    for (; findid <= TeslaScheduleIDs.Last && usedScheduleIDs.has(findid); findid++);
                    if (findid > TeslaScheduleIDs.Last) {
                      throw new Error("Failed to find a schedule ID");
                    }
                    s.id = findid;
                    usedScheduleIDs.add(findid);
                  }
                }
              }
            }
          }

          if (needBlocker) {
            // Default to blocking 5 minutes in the past (rounded down to 15 minutes)
            const wantedBlock = Math.floor((Date.now() - 5 * 60e3) / (15 * 60e3)) * 15 * 60e3;

            // If we don't have a block or the old block is more than 6 hours old, we need a new one
            if (vehicleSchedules[TeslaScheduleIDs.Block] === undefined
              || (vehicleSchedules[TeslaScheduleIDs.Block].chargeStop || 0) < wantedBlock - 6 * 60 * 60e3) {
              
              scheduleUpdates.push({
                ...this.convertToTeslaSchedule({ scheduleID: TeslaScheduleIDs.Block, chargeStart: null, chargeStop: wantedBlock }, location),
                comment: "back-dated schedule to stop default charging"
              });
              delete vehicleSchedules[TeslaScheduleIDs.Block];
            }
          }

          // Remove any remaining, unclaimed schedules
          for (const s of Object.values(vehicleSchedules)) {
            log(LogLevel.Debug, `${vehicle.vin} removing old schedule ${s.scheduleID}`);
            removeScheduleIDs.push(s.scheduleID);
          }

          // Check smartcharge schedule if we need to setup a precondition
          const scSchedule = vehicle.dbData.schedule
            .filter((f) => f.type === GQLScheduleType.Trip && f.time && new Date(f.time).getTime() > Date.now())
            .sort((a, b) => compareStopTimes(a.time, b.time));
          if (scSchedule.length > 0) {
            const departure = this.ConvertUTCtoLocationTime(location, new Date(scSchedule[0].time!));
            preconditionSchedule = {
              id: TeslaScheduleIDs.Precondition,
              days_of_week: 1 << departure.getUTCDay(),
              enabled: true,
              latitude: location.geoLocation.latitude,
              longitude: location.geoLocation.longitude,
              precondition_time: (departure.getUTCHours() * 60 + departure.getUTCMinutes()),
              one_time: true,
            };
          }
        }

        log(LogLevel.Debug, `${vehicle.vin} schedule updates: ${JSON.stringify(scheduleUpdates)}`);

        if (vehicle.isOnline) {
          // TODO: Add a check between vehicle.telemetryData.Scheduled* field and what we want
          // then re-poll schedules with the data api if it doesn't match

          // Apply schedule updates
          const currentPrecon = vehicle.precondition_schedules[TeslaScheduleIDs.Precondition];
          if (preconditionSchedule !== undefined) {
            if (currentPrecon === undefined
              || Math.abs(currentPrecon.latitude - preconditionSchedule.latitude) > 1e-4  // 11 meters
              || Math.abs(currentPrecon.longitude - preconditionSchedule.longitude) > 1e-4  // 11 meters
              || currentPrecon.precondition_time !== preconditionSchedule.precondition_time
              || currentPrecon.days_of_week !== preconditionSchedule.days_of_week) {
              log(LogLevel.Info, `${vehicle.vin} updating precondition schedule`);
              await this.callTeslaAPI(job, teslaAPI.addPreconditionSchedule, vehicle.vin, preconditionSchedule);
              vehicle.precondition_schedules[TeslaScheduleIDs.Precondition] = preconditionSchedule;
            } else {
              log(LogLevel.Debug, `${vehicle.vin} precondition schedule is correct`);
            }
          } else if (currentPrecon !== undefined) {
            log(LogLevel.Info, `${vehicle.vin} removing precondition schedule`);
            await this.callTeslaAPI(job, teslaAPI.removePreconditionSchedule, vehicle.vin, TeslaScheduleIDs.Precondition);
            delete vehicle.precondition_schedules[TeslaScheduleIDs.Precondition];
          }

          for (const s of scheduleUpdates) {
            assert(s.id !== undefined, "Invalid schedule ID");
            log(LogLevel.Info, `${vehicle.vin} updating schedule ${s.id} to start at ${s.start_time} and end at ${s.end_time}`);
            await this.callTeslaAPI(job, teslaAPI.addChargeSchedule, vehicle.vin, s);
            // TODO: Add history logger using s.comment
            vehicle.charge_schedules[s.id] = s;
          }
          for (const s of removeScheduleIDs) {
            log(LogLevel.Info, `${vehicle.vin} removing schedule ${s}`);
            await this.callTeslaAPI(job, teslaAPI.removeChargeSchedule, vehicle.vin, s);
            delete vehicle.charge_schedules[s];
          }

          // Update vehicle max charge level (but only if we are connected)
          if (this.isConnected(vehicle) && wantedSoc !== undefined) {
            const limitedWantedSoc = Math.max(parseInt(config.LOWEST_POSSIBLE_CHARGETO), Math.min(wantedSoc, 100));
            if (vehicle.telemetryData.ChargeLimitSoc !== limitedWantedSoc) {
              log(LogLevel.Info, `${vehicle.vin} setting charge limit to ${limitedWantedSoc}%`);
              await this.callTeslaAPI(job, teslaAPI.setChargeLimit, vehicle.vin, limitedWantedSoc);
            }
          }
        }
      }
    } catch (err) {
      // Check if err is RestClientError
      if (err instanceof RestClientError) {
        if (err.code === 408) { // Request timeout
          log(LogLevel.Warning, `Request timeout for ${vehicle.vin} (${err.message})`);
          vehicle.network = {};
          await this.updateOnlineStatus(vehicle);
          return;
        }
      }
      log(LogLevel.Error, `Failed to get charge schedules for ${vehicle.vin}: ${err}`);
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

    const isOnline = Object.keys(vehicle.network).length > 0;
    if (vehicle.isOnline !== isOnline) {
      vehicle.isOnline = isOnline;
      if (isOnline) {
        update.status = `Online (${Object.values(vehicle.network).join(", ")})`;
      } else {
        update.status = vehicle.isSleepy ? "Sleeping" : "Offline";
      }
    }
    if (Object.keys(update).length > 1) {
      log(LogLevel.Debug, `Updating vehicle ${vehicle.vin}: ${JSON.stringify(update)}`);
      vehicle.dbData = await this.scClient.updateVehicle(update);
    }
  }

  public async telemetryConnectivityMessage(
    data: telemetryConnectivity.VehicleConnectivity
  ) {
    log(LogLevel.Info, `Tesla Telmetry connectivity ${data.vin} ${data.connectionId} ${data.networkInterface} ${telemetryConnectivity.ConnectivityEvent[data.status]}`);
    const vehicle = this.vehicleEntry(data.vin);
    vehicle.tsUpdate = Date.now();

    if (data.status === telemetryConnectivity.ConnectivityEvent.DISCONNECTED) {
      delete vehicle.network[data.connectionId];
    } else if (data.status === telemetryConnectivity.ConnectivityEvent.CONNECTED) {
      vehicle.network[data.connectionId] = data.networkInterface;
    }
    if (vehicle.vehicleUUID) {
      await this.updateOnlineStatus(vehicle);
    }
  }

  public async telemetryDataMessage(vin: string, datum: telemetryData.Datum) {
    if (!datum.value) return;
    const key = datum.key;
    const value = datum.value && datum.value.value;

    log(LogLevel.Trace, `Telemetry data for ${vin}: ${telemetryData.Field[key]} = ${value.value} (${value.case})`);

    const vehicle = this.vehicleEntry(vin);
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
      switch (key) {
        case telemetryData.Field.FastChargerType:
        case telemetryData.Field.ChargeState:
        case telemetryData.Field.ScheduledDepartureTime:
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
        default:
        // TODO: Add this when we remove the top trace that logs all telemetry data
        //log(LogLevel.Trace, `Unhandled telemetry data for ${vin}: ${telemetryData.Field[key]} = ${value.value} (${value.case})`);
        //break;
      }
      // charger_phases seems to be reported wrong, or I simply don't understand and someone could explain it?
      // Tesla Wall Connector in Sweden reports 2 phases, 16 amps, and 230 volt = 2*16*230 = 7kW,
      // the correct number should be 11 kW on 3 phases (3*16*230).
      // I used the following formula to calculate the correct number of phases:
      // (charger_power * 1e3) / (charger_actual_current * charger_voltage)
    }

    if (vehicle.vehicleUUID) {
      if (vehicle.isUpdating) {
        log(LogLevel.Info, `Vehicle ${vin} is already updating, waiting for it to finish`);
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
              log(LogLevel.Debug, `Updating vehicle ${vehicle.vin} with ${JSON.stringify(vehicleUpdate)}`);
              innerPromises.push((async () => {
                vehicle.dbData = await this.scClient.updateVehicle(vehicleUpdate);
              })());
            }

            const vehicleDataUpdate = diffObjects(vehicle.vehicleDataInput, vehicle.lastVehicleDataInput);
            vehicle.vehicleDataInput = { ...vehicle.lastVehicleDataInput, ...vehicle.vehicleDataInput };
            vehicle.lastVehicleDataInput = { ...vehicle.vehicleDataInput };
            if (Object.keys(vehicleDataUpdate).length > 0) {
              assert(vehicle.vehicleUUID !== null, "vehicleUUID is null");

              log(LogLevel.Debug, `Updating vehicle data ${vehicle.vin} with ${JSON.stringify(vehicleDataUpdate)}`);
              innerPromises.push(this.scClient.updateVehicleData({
                id: vehicle.vehicleUUID,
                ...vehicleDataUpdate,
              }));
            }

            await Promise.all(innerPromises);
          } catch (err) {
            log(LogLevel.Error, `Error in updatePromise: ${err}`);
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
