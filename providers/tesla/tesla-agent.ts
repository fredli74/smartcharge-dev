/* eslint-disable require-atomic-updates */
/**
 * @file TeslaAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import * as fs from "fs";
import {
  log,
  logFormat,
  LogLevel,
  numericStopTime,
  numericStartTime,
} from "@shared/utils";
import { SCClient } from "@shared/sc-client";
import config from "./tesla-config";
import teslaAPI, { TeslaAPI } from "./tesla-api";
import {
  AgentJob,
  AbstractAgent,
  IProviderAgent,
  AgentAction,
} from "@providers/provider-agent";
import provider, {
  TeslaServiceData,
  TeslaProviderMutates,
  TeslaProviderQueries,
  TeslaToken,
} from ".";
import {
  GQLVehicle,
  GQLUpdateVehicleDataInput,
  GQLChargeConnection,
  GQLChargePlan,
  GQLChargeType,
  GQLAction,
  GQLScheduleType,
} from "@shared/sc-schema";
import { scheduleMap } from "@shared/sc-utils";

type PollState = "polling" | "tired" | "offline" | "asleep";
enum ChargeControl {
  Starting,
  Started,
  Stopping,
  Stopped,
}

interface TeslaSubject {
  vehicleUUID: string;
  vin: string;
  data?: GQLVehicle;
  online: boolean;
  pollerror: number | undefined;
  pollstate: PollState | undefined;
  statestart: number;
  status: string;
  keepAwake?: number; // last event where we wanted to stay awake
  debugSleep?: any; // TODO: remove?
  climateEnabled?: boolean; // remember it because we can't poll it if asleep
  chargeLimit?: number; // remember it because we can't poll it if asleep
  chargeEnabled?: boolean; // remember it because we can't poll it if asleep
  chargeControl?: ChargeControl; // keep track of last charge command to enable user charge control overrides
  portOpen?: boolean; // is charge port open
  parked?: number; // are we parked
  triedOpen?: number; // timestamp when we tried to open the port
  hvacOn?: number; // timestamp when we tried to turn on hvac
  hvacOverride?: number; // timestamp when user interacted with vehicle
  calibrating?: {
    next: number;
    level: number;
    duration: number;
  };
}

interface TeslaAgentState {
  [teslaID: string]: TeslaSubject;
}
interface TeslaAgentJob extends AgentJob {
  serviceData: TeslaServiceData;
  mapped: number;
  state: TeslaAgentState;
}

export class TeslaAgent extends AbstractAgent {
  public name: string = provider.name;
  constructor(scClient: SCClient) {
    super(scClient);
  }

  public newState(): TeslaAgentState {
    return {};
  }
  private changePollstate(subject: TeslaSubject, state: PollState) {
    if (subject.pollstate === state) return;
    subject.pollstate = state;
    subject.statestart = Date.now();
    subject.online = state !== "offline" && state !== "asleep";
  }

  public async setStatus(subject: TeslaSubject, status: string) {
    if (subject.status !== status) {
      this.scClient.updateVehicle({ id: subject.vehicleUUID, status: status });
      subject.status = status;
    }
  }

  // Check token and refresh through server provider API
  public async maintainToken(job: TeslaAgentJob) {
    // API Token check and update
    const token = job.serviceData.token as TeslaToken;
    if (TeslaAPI.tokenExpired(token)) {
      log(LogLevel.Trace, `${job.serviceID} token expired, calling server API for refresh`);
      // Token has expired, run it through server
      const newToken = await this.scClient.providerMutate("tesla", {
        mutation: TeslaProviderMutates.RefreshToken,
        token,
      });
      for (const j of Object.values(this.services)) {
        if (
          (j as TeslaAgentJob).serviceData.token.refresh_token ===
          token.refresh_token
        ) {
          (j as TeslaAgentJob).serviceData.token = newToken;
        }
      }
      assert(job.serviceData.token.access_token === newToken.access_token);
    }
  }

  private async wentOffline(subject: TeslaSubject) {
    if (subject.debugSleep !== undefined) {
      subject.debugSleep.now = Date.now();
      subject.debugSleep.success = true;
      await this.scClient.vehicleDebug({
        id: subject.vehicleUUID,
        category: "sleep",
        timestamp: new Date().toISOString(),
        data: subject.debugSleep,
      });
    }
  }

  private stayOnline(subject: TeslaSubject) {
    this.changePollstate(subject, "polling"); // Active polling
    subject.keepAwake = Date.now() + parseInt(config.TIME_BEFORE_TIRED);
  }

  private async vehicleInteraction(
    job: TeslaAgentJob,
    subject: TeslaSubject,
    wakeup: boolean,
    userInteraction: boolean
  ): Promise<boolean> {
    if (job.serviceData.invalid_token) return false; // provider requires a valid token
    if (!subject.online && !wakeup) return false; // offline and we should not wake it up

    await this.maintainToken(job);
    if (!subject.online) {
      log(
        LogLevel.Info,
        `${subject.vin} waking up ${
          (subject.data && subject.data.name) || subject.vehicleUUID
        }`
      );
      const data = await teslaAPI.wakeUp(subject.vin, job.serviceData.token);
      if (data && data.response && data.response.state === "online") {
        subject.online = true;
      }
      this.adjustInterval(job, 30); // poll more often after wakeup
    }
    if (subject.online) {
      this.stayOnline(subject);
      if (userInteraction) {
        this.adjustInterval(job, 0); // poll directly after an interaction
      }
      return true;
    }
    // this.adjustInterval(job, 10); // poll more often after an interaction
    return false;
  }

  private async poll(job: TeslaAgentJob, subject: TeslaSubject): Promise<void> {
    try {
      const now = Date.now();

      if (!subject.data || subject.data.providerData.disabled) {
        subject.data = await this.scClient.getVehicle(subject.vehicleUUID);
        if (subject.data.providerData.disabled) {
          log(
            LogLevel.Trace,
            `${subject.vin} disabled by user for ${subject.data.name}`
          );
          return;
        }
      }

      await this.maintainToken(job);

      const timeTryingToSleep =
        subject.data.providerData.time_tired || config.TIME_BEING_TIRED;

      // API Poll
      if (
        subject.pollstate === "polling" || // Poll vehicle data if we are in polling state
        (subject.pollstate === "tired" &&
          now >= subject.statestart + timeTryingToSleep) // or if we've been trying to sleep for TIME_BEING_TIRED seconds
      ) {
        const data = (
          await teslaAPI.getVehicleData(subject.vin, job.serviceData.token)
        ).response;
        log(
          LogLevel.Trace,
          `${subject.vin} full poll : ${JSON.stringify(data)}`
        );
        if (config.AGENT_SAVE_TO_TRACEFILE === "true") {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as",
          });
        }

        // Work-around for the strange trickle charge behavior
        // added for Model S in 2020.16.2.1 upgrade
        if (
          (subject.data.providerData.car_type === "models" ||
            subject.data.providerData.car_type === "models2" ||
            subject.data.providerData.car_type === "modelx") &&
          data.charge_state.charging_state === "Complete" &&
          data.charge_state.user_charge_enable_request !== false
        ) {
          if (subject.chargeControl === ChargeControl.Stopped) {
            log(
              LogLevel.Trace,
              `${subject.vin} trickle-charge fix stop of ${subject.data.name} overridden by user interaction`
            );
          } else {
            // known location or force disable
            log(
              LogLevel.Info,
              `${subject.vin} trickle-charge fix stop charging ${subject.data.name}`
            );
            teslaAPI.chargeStop(subject.vin, job.serviceData.token);
            subject.chargeControl = ChargeControl.Stopping;
          }
        }

        subject.pollerror = undefined;
        subject.chargeLimit = data.charge_state.charge_limit_soc;
        subject.climateEnabled = data.climate_state.is_climate_on;
        // data.climate_state.remote_heater_control_enabled;    found situations where this was true while climate was turned off
        subject.chargeEnabled =
          data.charge_state.user_charge_enable_request !== null
            ? data.charge_state.user_charge_enable_request
            : data.charge_state.charging_state === "Stopped"
            ? false
            : data.charge_state.charge_enable_request;
        subject.portOpen = data.charge_state.charge_port_door_open;
        subject.online = true;

        const chargingTo =
          data.charge_state.charging_state === "Charging"
            ? Math.trunc(data.charge_state.charge_limit_soc)
            : null;

        // charger_phases seems to be reported wrong, or I simply don't understand and someone could explain it?
        // Tesla Wall Connector in Sweden reports 2 phases, 16 amps, and 230 volt = 2*16*230 = 7kW,
        // the correct number should be 11 kW on 3 phases (3*16*230).
        const phases =
          data.charge_state.charger_actual_current > 0 &&
          data.charge_state.charger_voltage > 1
            ? Math.round(
                (data.charge_state.charger_power * 1e3) /
                  data.charge_state.charger_actual_current /
                  data.charge_state.charger_voltage
              )
            : 0;
        // const phases = data.charge_state.charger_phases;

        // Own power use calculation because tesla API only gives us integers which is crap when slow amp charging
        const powerUse =
          phases > 0 // we get 0 phases when DC charging because current is 0
            ? (data.charge_state.charger_actual_current * // amp
                phases * // * phases
                data.charge_state.charger_voltage) /
              1e3 // * voltage = watt / 1000 = kW
            : data.charge_state.charger_power; // fallback to API reported power

        // Update info
        const input: GQLUpdateVehicleDataInput = {
          id: subject.vehicleUUID,
          geoLocation: {
            latitude: data.drive_state.latitude,
            longitude: data.drive_state.longitude,
          },
          batteryLevel: Math.trunc(data.charge_state.usable_battery_level), // battery level in %
          odometer: Math.trunc(data.vehicle_state.odometer * 1609.344), // 1 mile = 1.609344 km
          outsideTemperature: data.climate_state.outside_temp, // in celcius
          insideTemperature: data.climate_state.inside_temp, // in celcius
          climateControl: data.climate_state.is_climate_on,
          isDriving:
            data.drive_state.shift_state === "D" || // Driving if shift_state is in Drive
            data.drive_state.shift_state === "R", // ... or in Reverse
          // Set connection type
          connectedCharger: data.charge_state.fast_charger_present
            ? GQLChargeConnection.DC // fast charger
            : data.charge_state.charging_state !== "Disconnected"
            ? GQLChargeConnection.AC
            : null, // any other charger or no charger
          chargingTo: chargingTo,
          estimatedTimeLeft: Math.round(
            data.charge_state.time_to_full_charge * 60
          ), // 1 hour = 60 minutes
          powerUse: chargingTo !== null ? powerUse : null,
          energyAdded: data.charge_state.charge_energy_added, // added kWh
        };

        const isGettingTired =
          (data.climate_state.outside_temp === null &&
            data.climate_state.inside_temp === null) || // Model S does this
          (subject.keepAwake || 0) < now;

        let insomnia = false; // Are we in a state where sleep is not possible

        // Set status
        if (input.chargingTo) {
          await this.setStatus(subject, "Charging"); // We are charging
          insomnia = true; // Can not sleep while charging
          // this.adjustInterval(job, 10); // Poll more often when charging
          this.adjustInterval(job, parseInt(config.TESLA_POLL_INTERVAL)); // not allowed to poll more than 5 minutes now
        } else if (input.isDriving) {
          await this.setStatus(subject, "Driving"); // We are driving
          insomnia = true; // Can not sleep while driving
          // this.adjustInterval(job, 10); // Poll more often when driving
          this.adjustInterval(job, parseInt(config.TESLA_POLL_INTERVAL)); // not allowed to poll more than 5 minutes now
        } else {
          this.adjustInterval(job, parseInt(config.TESLA_POLL_INTERVAL));
          if (data.vehicle_state.is_user_present) {
            await this.setStatus(subject, "Idle (user present)");
            insomnia = true;
          } else if (data.climate_state.climate_keeper_mode === "dog") {
            await this.setStatus(subject, "Idle (dog mode on)");
            insomnia = true;
          } else if (data.climate_state.is_climate_on) {
            await this.setStatus(subject, "Idle (climate on)");
            insomnia = true;
          } else if (data.vehicle_state.sentry_mode) {
            await this.setStatus(subject, "Idle (sentry on)");
            insomnia = true;
          } else if (subject.pollstate === "tired") {
            if (subject.debugSleep !== undefined) {
              subject.debugSleep.now = now;
              subject.debugSleep.success = false;
              await this.scClient.vehicleDebug({
                id: subject.vehicleUUID,
                category: "sleep",
                timestamp: new Date().toISOString(),
                data: subject.debugSleep,
              });
              subject.debugSleep.info = data;
            }
            subject.statestart = now; // Reset state start to only poll once every TIME_BEING_TIRED
          } else if (isGettingTired) {
            await this.setStatus(subject, "Waiting to sleep"); // We were idle for TIME_BEFORE_TIRED
            this.changePollstate(subject, "tired");
            subject.debugSleep = {
              now: now,
              start: now,
              success: false,
              info: data,
            }; // Save current state to debug sleep tries
          } else {
            await this.setStatus(subject, "Idle");
          }
        }
        if (insomnia) {
          this.stayOnline(subject);
        }
        await this.scClient.updateVehicleData(input);

        // Set car_type and option_codes if missing
        if (
          subject.data.providerData.unknown_image ||
          subject.data.providerData.car_type === undefined ||
          subject.data.providerData.option_codes === undefined
        ) {
          const option_codes = [];
          const options = await teslaAPI.getVehicleOptions(
            subject.vin,
            job.serviceData.token
          );
          let unknown_image;
          if (Array.isArray(options.codes)) {
            unknown_image = null;
            for (const entry of options.codes) {
              if (entry.isActive) {
                option_codes.push(entry.code);
              }
            }
          } else {
            unknown_image = true;
          }
          await this.scClient.updateVehicle({
            id: subject.vehicleUUID,
            providerData: {
              car_type: data.vehicle_config.car_type,
              unknown_image,
              option_codes,
            },
          });
        }

        // Charge calibration
        if (
          subject.calibrating &&
          powerUse > 0 &&
          now > subject.calibrating.next
        ) {
          const thisLimit = data.charge_state.charge_limit_soc;
          const lastLimit = subject.calibrating.level;
          const levelNow = data.charge_state.usable_battery_level;
          if (thisLimit <= levelNow) {
            subject.calibrating.level = levelNow;
            subject.calibrating.duration = 0;
          } else if (thisLimit > lastLimit) {
            const thisTime = data.charge_state.time_to_full_charge * 3600;
            const lastDuration = subject.calibrating.duration;
            let duration = thisTime / (thisLimit - levelNow);

            if (lastDuration > 0 && levelNow < lastLimit) {
              const lastTime =
                (lastLimit - levelNow) * subject.calibrating.duration;
              duration = Math.max(
                duration,
                (thisTime - lastTime) / (thisLimit - lastLimit)
              );
            }
            subject.calibrating.level = thisLimit;
            subject.calibrating.duration = duration;
            await this.scClient.chargeCalibration(
              subject.vehicleUUID,
              subject.calibrating.level,
              Math.round(subject.calibrating.duration),
              powerUse
            );
          }
        }

        if (
          !subject.hvacOverride &&
          (data.climate_state.climate_keeper_mode !== "off" ||
            data.climate_state.smart_preconditioning ||
            data.drive_state.shift_state === "D" ||
            data.drive_state.shift_state === "R" ||
            data.vehicle_state.is_user_present ||
            data.vehicle_state.df > 0 ||
            data.vehicle_state.dr > 0 ||
            data.vehicle_state.pf > 0 ||
            data.vehicle_state.pr > 0 ||
            data.vehicle_state.ft > 0 ||
            data.vehicle_state.rt > 0)
        ) {
          // User has interacted with the car so leave the hvac alone
          subject.hvacOverride = now;
        }
      } else {
        // Poll vehicle list to avoid keeping it awake
        const data = (
          await teslaAPI.listVehicle(subject.vin, job.serviceData.token)
        ).response;
        if (config.AGENT_SAVE_TO_TRACEFILE === "true") {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as",
          });
        }
        log(
          LogLevel.Trace,
          `${subject.vin} list poll : ${JSON.stringify(data)}`
        );

        this.adjustInterval(job, parseInt(config.TESLA_POLL_INTERVAL));
        switch (data.state) {
          case "online":
            if (
              subject.pollstate === undefined ||
              subject.pollstate === "asleep" ||
              subject.pollstate === "offline"
            ) {
              // We were offline or sleeping
              log(
                LogLevel.Info,
                `${subject.vin} ${data.display_name} is ${data.state} (${subject.pollstate} -> polling)`
              );
              if (subject.pollerror) {
                this.changePollstate(subject, "polling"); // Active polling
              } else {
                this.stayOnline(subject);
                this.adjustInterval(job, 0); // Woke up, poll right away
              }
              return;
            }
            break;
          case "offline":
            if (subject.pollstate !== "offline") {
              log(
                LogLevel.Info,
                `${subject.vin} ${data.display_name} is ${data.state} (${subject.pollstate} -> offline)`
              );

              this.changePollstate(subject, "offline");
              await this.setStatus(subject, "Offline");
              await this.wentOffline(subject);
            }
            break;
          case "asleep":
            if (subject.pollstate !== "asleep") {
              log(
                LogLevel.Info,
                `${subject.vin} ${data.display_name} is ${data.state} (${subject.pollstate} -> asleep)`
              );

              this.changePollstate(subject, "asleep");
              await this.setStatus(subject, "Sleeping");
              await this.wentOffline(subject);
            }
            break;
          default: {
            const s = logFormat(
              LogLevel.Error,
              `${subject.vin} unknown state: ${JSON.stringify(data)}`
            );
            fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
              flag: "as",
            });
            console.error(s);
          }
        }
      }

      if (subject.data.providerData.invalid_token) {
        await this.scClient.updateVehicle({
          id: subject.vehicleUUID,
          providerData: { invalid_token: null },
        });
      }

      const previousData = subject.data;
      subject.data = await this.scClient.getVehicle(subject.vehicleUUID);

      const wasDriving = Boolean(
        previousData &&
          (previousData.isDriving ||
            subject.data.odometer - previousData.odometer >= 200) // Vehicle moved 200 meters
      );

      if (subject.data.isDriving) {
        subject.triedOpen = undefined;
        subject.parked = undefined;
        subject.chargeControl = undefined;
      } else if (wasDriving) {
        subject.parked = now;
        subject.chargeControl = undefined;
      }

      log(LogLevel.Trace, `${subject.vin} ${JSON.stringify(subject)}`);

      // Reduce the array to a map with only the first upcoming event of each type
      const schedule = scheduleMap(subject.data.schedule);
      const disabled = schedule[GQLScheduleType.Disable];
      if (disabled && now < numericStopTime(disabled.time)) {
        // Command disabled
        return;
      }

      // Command logic
      if (subject.data.isConnected) {
        // did we control the charge?
        if (
          subject.chargeEnabled === true &&
          subject.chargeControl === ChargeControl.Starting
        ) {
          subject.chargeControl = ChargeControl.Started;
        } else if (
          subject.chargeEnabled === false &&
          subject.chargeControl === ChargeControl.Stopping
        ) {
          subject.chargeControl = ChargeControl.Stopped;
        }

        // do we have a charge plan
        let shouldCharge: GQLChargePlan | undefined = undefined;
        let disableCharge: boolean = false;
        if (subject.data.chargePlan) {
          for (const p of subject.data.chargePlan) {
            if (p.chargeType === GQLChargeType.Disable) {
              disableCharge = true;
            } else if (
              (p.chargeType === GQLChargeType.Manual &&
                p.chargeStart === null) ||
              (now >= numericStartTime(p.chargeStart) &&
                now < numericStopTime(p.chargeStop))
            ) {
              shouldCharge = p;
              break;
            }
          }
        }

        // are we following the plan
        if (
          shouldCharge === undefined &&
          subject.online &&
          subject.chargeEnabled === true &&
          subject.data.chargingTo !== null &&
          subject.data.batteryLevel < subject.data.chargingTo // keep it running if we're above or on target
        ) {
          if (subject.chargeControl === ChargeControl.Stopped) {
            log(
              LogLevel.Trace,
              `${subject.vin} charge stop of ${subject.data.name} overridden by user interaction`
            );
          } else if (
            (subject.data.locationID !== null || disableCharge) &&
            (await this.vehicleInteraction(job, subject, false, false))
          ) {
            // known location or force disable
            log(
              LogLevel.Info,
              `${subject.vin} stop charging ${subject.data.name}`
            );
            teslaAPI.chargeStop(subject.vin, job.serviceData.token);
            subject.chargeControl = ChargeControl.Stopping;
            this.stayOnline(subject);
          }
        } else if (shouldCharge !== undefined) {
          if (subject.chargeEnabled !== true) {
            if (subject.chargeControl === ChargeControl.Started) {
              log(
                LogLevel.Trace,
                `${subject.vin} charge start of ${subject.data.name} overridden by user interaction`
              );
            } else if (
              subject.data.batteryLevel < shouldCharge.level &&
              (await this.vehicleInteraction(job, subject, true, false))
            ) {
              log(
                LogLevel.Info,
                `${subject.vin} start charging ${subject.data.name}`
              );
              await teslaAPI.chargeStart(subject.vin, job.serviceData.token);
              subject.chargeControl = ChargeControl.Starting;
              this.stayOnline(subject);
            }
          }

          let setLevel = shouldCharge.level;
          if (shouldCharge.chargeType === GQLChargeType.Calibrate) {
            if (!subject.calibrating) {
              subject.calibrating = {
                level: Math.max(
                  parseInt(config.LOWEST_POSSIBLE_CHARGETO),
                  subject.data.batteryLevel
                ),
                duration: 0,
                next: now + 30e3,
              };
            }
            if (subject.calibrating.level >= shouldCharge.level) {
              // done!
              setLevel = 0;
            } else {
              setLevel = subject.calibrating.level + 1;
              if (subject.chargeLimit !== setLevel) {
                subject.calibrating.next = Math.max(
                  now + 15e3,
                  subject.calibrating.next
                );
              }
            }
          } else if (subject.calibrating) {
            delete subject.calibrating;
          }

          const chargeto = Math.max(
            parseInt(config.LOWEST_POSSIBLE_CHARGETO),
            setLevel
          ); // Minimum allowed charge for Tesla is 50

          if (
            subject.chargeLimit !== undefined && // Only controll if polled at least once
            (subject.chargeLimit < chargeto ||
              (subject.chargeLimit > chargeto &&
                (shouldCharge.chargeType === GQLChargeType.Manual ||
                  subject.data.locationID !== null)))
          ) {
            if (await this.vehicleInteraction(job, subject, true, false)) {
              log(
                LogLevel.Info,
                `${subject.vin} setting charge limit for ${subject.data.name} to ${chargeto}%`
              );
              await teslaAPI.setChargeLimit(
                subject.vin,
                chargeto,
                job.serviceData.token
              );
              this.stayOnline(subject);
            }
          }
        }
      } else {
        if (
          subject.data.locationID !== null &&
          subject.data.providerData.auto_port &&
          subject.parked !== undefined &&
          subject.data.chargePlan &&
          subject.data.chargePlan.findIndex(
            (f) =>
              f.chargeType !== GQLChargeType.Disable &&
              f.chargeType !== GQLChargeType.Fill &&
              f.chargeType !== GQLChargeType.Manual &&
              f.chargeType !== GQLChargeType.Prefered
          ) >= 0
        ) {
          if (
            now < subject.parked + 1 * 60e3 && // only open during the first minute
            !subject.portOpen &&
            subject.triedOpen === undefined
          ) {
            if (await this.vehicleInteraction(job, subject, false, false)) {
              // if port is closed and we did not try to open it yet
              await teslaAPI.openChargePort(subject.vin, job.serviceData.token);
            }
            subject.triedOpen = now;
          } else if (
            now > subject.parked + 3 * 60e3 && // keep port open for 3 minutes
            subject.portOpen &&
            subject.triedOpen !== undefined
          ) {
            if (await this.vehicleInteraction(job, subject, false, false)) {
              await teslaAPI.closeChargePort(
                subject.vin,
                job.serviceData.token
              );
            }
            subject.triedOpen = undefined;
          }
        }
      }
      // Should we turn on hvac?
      if (subject.data.providerData.auto_hvac) {
        const trip = schedule[GQLScheduleType.Trip];
        const after =
          !trip ||
          now >
            numericStopTime(trip.time) + parseInt(config.TRIP_HVAC_ON_DURATION);
        const inWindow =
          trip &&
          now >=
            numericStartTime(trip.time) -
              parseInt(config.TRIP_HVAC_ON_WINDOW) &&
          !after;

        if (inWindow && !subject.hvacOn && !subject.hvacOverride) {
          // we're inside hvac window, we did not turn it on, and we were not told to leave it alone
          if (subject.climateEnabled) {
            subject.hvacOn = subject.hvacOn || now;
          } else {
            log(
              LogLevel.Info,
              `${subject.vin} starting climate control on ${subject.data.name}`
            );
            await this[AgentAction.ClimateControl](job, {
              data: { id: subject.vehicleUUID, enable: true },
            } as any);
          }
        } else if (
          after &&
          subject.hvacOn &&
          subject.climateEnabled &&
          !subject.hvacOverride
        ) {
          // we're after hvac window, we did turn it on, it's still on, and we were not told to leave it alone
          log(
            LogLevel.Info,
            `${subject.vin} stopping climate control on ${subject.data.name}`
          );
          await this[AgentAction.ClimateControl](job, {
            data: { id: subject.vehicleUUID, enable: false },
          } as any);
        } else if (!inWindow && !subject.climateEnabled) {
          // we're outside of hvac window, hvac is turned off, reset state
          delete subject.hvacOn;
          delete subject.hvacOverride;
        }
      }
    } catch (err: any) {
      if (config.AGENT_SAVE_TO_TRACEFILE === "true") {
        const s = logFormat(LogLevel.Error, err);
        fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, { flag: "as" });
      }

      subject.pollerror = err.code;
      this.adjustInterval(job, parseInt(config.TESLA_POLL_INTERVAL)); // avoid spam polling an interface that is down

      // this.changePollstate(subject, "offline");
      // this.adjustInterval(job, 10); // Try again

      // TODO: handle different errors?
      if (err.code === 401) {
        log(
          LogLevel.Trace,
          `${subject.vin} tesla-agent polling error 401 for ${JSON.stringify(
            job.serviceData
          )}`
        );
        try {
          const newToken = await this.scClient.providerMutate("tesla", {
            mutation: TeslaProviderMutates.RefreshToken,
            refresh_token: job.serviceData.token.refresh_token,
          });
          delete job.serviceData.invalid_token; // client side update to match server
          job.serviceData.token = newToken; // client side update to match server
        } catch (err) {
          log(
            LogLevel.Error,
            `${subject.vin} unable to refresh teslaAPI token for ${
              subject.vin
            }: ${JSON.stringify(err)}`
          );
          job.serviceData.invalid_token = true; // client side update to match server
        }
      } else if (err.code === 404) {
        // Vehicle ID does not exist, trigger a remap
        job.mapped = 0;
      } else if (err.code === 405) {
        this.changePollstate(subject, "offline");
      } else if (err.code === 408) {
        this.changePollstate(subject, "offline");
      }

      if (err.response && err.response.data) {
        log(
          LogLevel.Error,
          `${subject.vin} ${JSON.stringify(err.response.data)}`
        );
        if (err.response.data.error) {
          await this.setStatus(subject, err.response.data.error);
        }
      } else {
        log(LogLevel.Error, `${subject.vin} ${JSON.stringify(err)}`);
      }
      throw new Error(err);
    }
  }

  public async serviceWork(job: TeslaAgentJob) {
    if (job.serviceData.invalid_token) {
      log(
        LogLevel.Trace,
        `Service ${job.serviceID} has an invalid token, skipping work`
      );
      return;
    }

    if (
      !job.mapped ||
      (job.serviceData.updated && job.mapped < job.serviceData.updated)
    ) {
      job.state = {};
      const list = await this.scClient.providerQuery("tesla", {
        query: TeslaProviderQueries.Vehicles,
        service_uuid: job.serviceID,
      });
      for (const v of list) {
        if (v.vehicle_uuid && !job.state[v.vehicle_uuid]) {
          job.state[v.vehicle_uuid] = {
            vehicleUUID: v.vehicle_uuid,
            vin: v.vin,
            online: false,
            pollerror: undefined,
            pollstate: undefined,
            statestart: Date.now(),
            status: "",
          };
          log(
            LogLevel.Debug,
            `Service ${job.serviceID} mapping VIN ${v.vin} -> UUID ${v.vehicle_uuid}`
          );
        } else {
          log(
            LogLevel.Debug,
            `Service ${job.serviceID} ignoring VIN ${v.vin} -> UUID ${v.vehicle_uuid}`
          );
        }
      }
      job.mapped = Date.now();
    }

    for (const s of Object.values(job.state)) {
      await this.poll(job, s);
    }
  }

  public async [AgentAction.Refresh](
    job: TeslaAgentJob,
    action: GQLAction
  ): Promise<any> {
    for (const subject of Object.values(job.state)) {
      if (subject.vehicleUUID === action.data.id) {
        return this.vehicleInteraction(job, subject, true, true);
      }
    }
  }
  public async [AgentAction.ClimateControl](
    job: TeslaAgentJob,
    action: GQLAction
  ): Promise<any> {
    if (!action || job.serviceData.invalid_token) return false; // provider requires a valid token

    for (const subject of Object.values(job.state)) {
      if (subject.vehicleUUID === action.data.id) {
        if (!(await this.vehicleInteraction(job, subject, true, true)))
          return false; // Not ready for interaction
        if (subject.data && subject.climateEnabled === action.data.enable)
          return true; // Already correct

        if (action.data.enable) {
          await teslaAPI.climateOn(subject.vin, job.serviceData.token);
        } else {
          await teslaAPI.climateOff(subject.vin, job.serviceData.token);
        }
      }
    }
    return false;
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new TeslaAgent(scClient),
};
export default agent;
