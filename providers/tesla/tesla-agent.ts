/* eslint-disable require-atomic-updates */
/**
 * @file TeslaAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { IRestToken, RestClient } from "@shared/restclient";
import * as fs from "fs";
import {
  log,
  logFormat,
  LogLevel,
  numericStopTime,
  numericStartTime
} from "@shared/utils";
import { SCClient } from "@shared/sc-client";
import config from "./tesla-config";
import teslaAPI from "./tesla-api";
import {
  AgentJob,
  AbstractAgent,
  IProviderAgent,
  AgentAction
} from "@providers/provider-agent";
import provider, {
  TeslaServiceData,
  TeslaProviderMutates,
  TeslaProviderQueries
} from ".";
import {
  GQLVehicle,
  GQLUpdateVehicleDataInput,
  GQLChargeConnection,
  GQLChargePlan,
  GQLChargeType,
  GQLAction,
  GQLScheduleType
} from "@shared/sc-schema";
import { scheduleMap } from "@shared/sc-utils";

type PollState = "polling" | "tired" | "offline" | "asleep";
enum ChargeControl {
  Starting,
  Started,
  Stopping,
  Stopped
}

interface TeslaSubject {
  teslaID: string;
  vehicleUUID: string;
  data?: GQLVehicle;
  online: boolean;
  pollstate: PollState | undefined;
  statestart: number;
  status: string;
  keepAwake?: number; // last event where we wanted to stay awake
  debugSleep?: any; // TODO: remove?
  chargeLimit?: number; // remember it because we can't poll it if asleep
  chargeEnabled?: boolean; // remember it because we can't poll it if asleep
  chargeControl?: ChargeControl; // keep track of last charge command to enable user charge control overrides
  portOpen?: boolean; // is charge port open
  parked?: number; // are we parked
  triedOpen?: number; // timestamp when we tried to open the port
  hvacOn?: number; // timestamp when we tried to turn on hvac
  hvacOff?: number; // timestamp when we tried to turn off hvac
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

  public async setOptionCodes(subject: TeslaSubject, data: any) {
    assert(subject.data !== undefined);
    assert(subject.data.providerData !== undefined);
    assert(data !== undefined);
    assert(data.vehicle_config !== undefined);

    /***** No option codes are correct from the API, so I make my own *****/

    const config = data.vehicle_config;
    let option_codes = [];
    let defaults: any;

    switch (config.car_type) {
      case "models":
        option_codes.push("MI02"); // force nose cone
        defaults = {
          exterior_color: "PPSW",
          roof_color: "RFP2",
          wheel_type: "WTAS"
        };
        break;
      case "models2":
        option_codes.push("MI03"); // force facelift
        defaults = {
          exterior_color: "PPSW",
          roof_color: "RFFG",
          wheel_type: "WTDS"
        };
        break;
      case "modelx":
        defaults = {
          exterior_color: "PPSW",
          roof_color: "RFPX",
          wheel_type: "WT20"
        };
        break;
      default:
        defaults = {
          exterior_color: "PPSW",
          roof_color: "RF3G",
          wheel_type: "W38B"
        };
        break;
    }

    let unknown_image = null;

    function optionTranslate(
      field: string,
      a: { [name: string]: string | null }
    ) {
      const d = String(config[field]);
      if (d === "undefined") {
        log(
          LogLevel.Warning,
          `${subject.teslaID} vehicle_config contains no ${field}`
        );
        return undefined;
      }
      if (a[d] === undefined) {
        log(
          LogLevel.Warning,
          `${subject.teslaID} unknown vehicle_config.${field} = ${d}`
        );
        unknown_image = true;
        return defaults[field];
      }
      return a[d];
    }

    option_codes.push(
      optionTranslate("exterior_color", {
        MidnightSilver: "PMNG",
        DeepBlue: "PPSB",
        SolidBlack: "PBSB",
        SteelGrey: "PMNG",
        RedMulticoat: "PPMR",
        Pearl: "PPSW",
        PearlWhite: "PPSW",
        SilverMetallic: "PMSS",
        Blue: "PMMB"
      })
    );

    option_codes.push(
      optionTranslate("roof_color", {
        Glass: defaults.roof_color,
        None: defaults.roof_color
      })
    );

    option_codes.push(
      optionTranslate("wheel_type", {
        Pinwheel18: "W38B",
        Stiletto19: "W39B",
        Stiletto20: "W32B",
        Slipstream19Carbon: "WTDS",
        // AeroTurbine19: "",
        Turbine19: "WTTB",
        Turbine22Dark: "WTUT"
      })
    );

    option_codes.push(
      optionTranslate("spoiler_type", {
        Passive: "X019", // X021",
        // "SLR1"
        None: null
      })
    );

    option_codes.push(
      optionTranslate("rhd", {
        true: "DRRH",
        false: "DRLH"
      })
    );

    if (
      typeof config.trim_badging === "string" &&
      config.trim_badging.match(/^p/i)
    ) {
      option_codes.push("BC0R"); // Red Brake Calipers
      option_codes.push("X024"); // Performance Package
    }

    option_codes = option_codes.filter(f => f !== undefined);

    if (
      subject.data.providerData.car_type !== config.car_type ||
      Boolean(subject.data.providerData.unknown_image) !==
        Boolean(unknown_image) ||
      JSON.stringify(subject.data.providerData.option_codes) !==
        JSON.stringify(option_codes)
    ) {
      await this.scClient.updateVehicle({
        id: subject.vehicleUUID,
        providerData: {
          car_type: config.car_type,
          unknown_image: unknown_image,
          option_codes: option_codes
        }
      });
    }
  }

  // Check token and refresh through server provider API
  public async maintainToken(job: TeslaAgentJob) {
    // API Token check and update
    const token = job.serviceData.token as IRestToken;
    if (RestClient.tokenExpired(token)) {
      // Token has expired, run it through server
      const token = job.serviceData.token as IRestToken;
      const newToken = await this.scClient.providerMutate("tesla", {
        mutation: TeslaProviderMutates.RefreshToken,
        token
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
        data: subject.debugSleep
      });
    }
  }

  private stayOnline(subject: TeslaSubject) {
    this.changePollstate(subject, "polling"); // Active polling
    subject.keepAwake = Date.now() + config.TIME_BEFORE_TIRED;
  }

  private async vehicleInteraction(
    job: TeslaAgentJob,
    subject: TeslaSubject,
    wakeup: boolean
  ): Promise<boolean> {
    if (job.serviceData.invalid_token) return false; // provider requires a valid token
    if (!subject.online && !wakeup) return false; // offline and we should not wake it up

    await this.maintainToken(job);
    if (!subject.online) {
      log(
        LogLevel.Info,
        `${subject.teslaID} waking up ${(subject.data && subject.data.name) ||
          subject.vehicleUUID}`
      );
      const data = await teslaAPI.wakeUp(
        subject.teslaID,
        job.serviceData.token
      );
      if (data && data.response && data.response.state === "online") {
        subject.online = true;
      }
    }
    if (subject.online) {
      this.stayOnline(subject);
      this.adjustInterval(job, 0); // poll directly after an interaction
      return true;
    }
    this.adjustInterval(job, 5); // poll more often after an interaction
    return false;
  }

  private async poll(job: TeslaAgentJob, subject: TeslaSubject): Promise<void> {
    try {
      const now = Date.now();

      if (!subject.data || subject.data.providerData.disabled) {
        subject.data = await this.scClient.getVehicle(subject.vehicleUUID);
        if (subject.data.providerData.disabled) return;
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
          await teslaAPI.getVehicleData(subject.teslaID, job.serviceData.token)
        ).response;
        log(
          LogLevel.Trace,
          `${subject.teslaID} full poll : ${JSON.stringify(data)}`
        );
        if (config.AGENT_SAVE_TO_TRACEFILE) {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as"
          });
        }

        subject.chargeLimit = data.charge_state.charge_limit_soc;
        subject.chargeEnabled =
          data.charge_state.charging_state !== "Stopped" &&
          (data.charge_state.charge_enable_request ||
            data.charge_state.charging_state === "Complete");
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
            longitude: data.drive_state.longitude
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
          energyAdded: data.charge_state.charge_energy_added // added kWh
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
          this.adjustInterval(job, 10); // Poll more often when charging
        } else if (input.isDriving) {
          await this.setStatus(subject, "Driving"); // We are driving
          insomnia = true; // Can not sleep while driving
          this.adjustInterval(job, 10); // Poll more often when driving
        } else {
          this.adjustInterval(job, 60);
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
                data: subject.debugSleep
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
              info: data
            }; // Save current state to debug sleep tries
          } else {
            await this.setStatus(subject, "Idle");
          }
        }
        if (insomnia) {
          this.stayOnline(subject);
        }
        await this.scClient.updateVehicleData(input);
        await this.setOptionCodes(subject, data);

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
          subject.hvacOn &&
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
          subject.hvacOff = now;
        }
      } else {
        // Poll vehicle list to avoid keeping it awake
        const data = (
          await teslaAPI.listVehicle(subject.teslaID, job.serviceData.token)
        ).response;
        if (config.AGENT_SAVE_TO_TRACEFILE) {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as"
          });
        }
        log(
          LogLevel.Trace,
          `${subject.teslaID} list poll : ${JSON.stringify(data)}`
        );

        this.adjustInterval(job, 60);
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
                `${subject.teslaID} ${data.display_name} is ${data.state} (${subject.pollstate} -> polling)`
              );
              this.stayOnline(subject);
              this.adjustInterval(job, 0); // Woke up, poll right away
              return;
            }
            break;
          case "offline":
            if (subject.pollstate !== "offline") {
              log(
                LogLevel.Info,
                `${subject.teslaID} ${data.display_name} is ${data.state} (${subject.pollstate} -> offline)`
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
                `${subject.teslaID} ${data.display_name} is ${data.state} (${subject.pollstate} -> asleep)`
              );

              this.changePollstate(subject, "asleep");
              await this.setStatus(subject, "Sleeping");
              await this.wentOffline(subject);
            }
            break;
          default: {
            const s = logFormat(
              LogLevel.Error,
              `${subject.teslaID} unknown state: ${JSON.stringify(data)}`
            );
            fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
              flag: "as"
            });
            console.error(s);
          }
        }
      }

      if (subject.data.providerData.invalid_token) {
        await this.scClient.updateVehicle({
          id: subject.vehicleUUID,
          providerData: { invalid_token: null }
        });
      }

      const wasDriving = Boolean(subject.data && subject.data.isDriving);
      subject.data = await this.scClient.getVehicle(subject.vehicleUUID);

      if (subject.data.isDriving) {
        subject.triedOpen = undefined;
        subject.parked = undefined;
      } else if (wasDriving) {
        assert(subject.parked === undefined);
        subject.parked = now;
      }

      log(LogLevel.Trace, `${subject.teslaID} ${JSON.stringify(subject)}`);

      // Reduce the array to a map with only the first upcoming event of each type
      const schedule = scheduleMap(subject.data.schedule);
      const disabled = schedule[GQLScheduleType.Disable];
      if (disabled && now < numericStopTime(disabled.time)) {
        // Command disabled
        return;
      }

      // Command logic
      if (subject.data.isConnected) {
        // are we charging or not
        if (
          subject.chargeEnabled &&
          (subject.chargeControl === undefined ||
            subject.chargeControl === ChargeControl.Starting)
        ) {
          subject.chargeControl = ChargeControl.Started;
        } else if (
          !subject.chargeEnabled &&
          (subject.chargeControl === undefined ||
            subject.chargeControl === ChargeControl.Stopping)
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
              `${subject.teslaID} charge stop of ${subject.data.name} overridden by user interaction`
            );
          } else if (
            (subject.data.locationID !== null || disableCharge) &&
            (await this.vehicleInteraction(job, subject, false))
          ) {
            // known location or force disable
            log(
              LogLevel.Info,
              `${subject.teslaID} stop charging ${subject.data.name}`
            );
            teslaAPI.chargeStop(subject.teslaID, job.serviceData.token);
            subject.chargeControl = ChargeControl.Stopping;
            this.stayOnline(subject);
          }
        } else if (shouldCharge !== undefined) {
          if (subject.chargeEnabled !== true) {
            if (subject.chargeControl === ChargeControl.Started) {
              log(
                LogLevel.Trace,
                `${subject.teslaID} charge start of ${subject.data.name} overridden by user interaction`
              );
            } else if (
              subject.data.batteryLevel < shouldCharge.level &&
              (await this.vehicleInteraction(job, subject, true))
            ) {
              log(
                LogLevel.Info,
                `${subject.teslaID} start charging ${subject.data.name}`
              );
              await teslaAPI.chargeStart(
                subject.teslaID,
                job.serviceData.token
              );
              subject.chargeControl = ChargeControl.Starting;
              this.stayOnline(subject);
            }
          } else {
            let setLevel = shouldCharge!.level;
            if (shouldCharge!.chargeType === GQLChargeType.Calibrate) {
              if (!subject.calibrating) {
                subject.calibrating = {
                  level: Math.max(
                    config.LOWEST_POSSIBLE_CHARGETO,
                    subject.data.batteryLevel
                  ),
                  duration: 0,
                  next: now + 30e3
                };
              }
              if (subject.calibrating.level >= shouldCharge!.level) {
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
              config.LOWEST_POSSIBLE_CHARGETO,
              setLevel
            ); // Minimum allowed charge for Tesla is 50

            if (
              subject.chargeLimit !== undefined && // Only controll if polled at least once
              (subject.chargeLimit < chargeto ||
                (subject.chargeLimit > chargeto &&
                  (shouldCharge.chargeType === GQLChargeType.Manual ||
                    subject.data.locationID !== null)))
            ) {
              if (await this.vehicleInteraction(job, subject, true)) {
                log(
                  LogLevel.Info,
                  `${subject.teslaID} setting charge limit for ${subject.data.name} to ${chargeto}%`
                );
                await teslaAPI.setChargeLimit(
                  subject.teslaID,
                  chargeto,
                  job.serviceData.token
                );
                this.stayOnline(subject);
              }
            }
          }
        }
      } else {
        subject.chargeControl = undefined;
        if (
          subject.data.locationID !== null &&
          subject.data.providerData.auto_port &&
          subject.parked !== undefined &&
          subject.data.chargePlan &&
          subject.data.chargePlan.findIndex(
            f =>
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
            if (await this.vehicleInteraction(job, subject, false)) {
              // if port is closed and we did not try to open it yet
              await teslaAPI.openChargePort(
                subject.teslaID,
                job.serviceData.token
              );
            }
            subject.triedOpen = now;
          } else if (
            now > subject.parked + 3 * 60e3 && // keep port open for 3 minutes
            subject.portOpen &&
            subject.triedOpen !== undefined
          ) {
            if (await this.vehicleInteraction(job, subject, false)) {
              await teslaAPI.closeChargePort(
                subject.teslaID,
                job.serviceData.token
              );
            }
            subject.triedOpen = undefined;
          }
        }
      }
      // Should we turn on hvac?
      const trip = schedule[GQLScheduleType.Trip];
      if (trip && subject.data.providerData.auto_hvac) {
        const on =
          now >= numericStartTime(trip.time) - config.TRIP_HVAC_ON_WINDOW &&
          now < numericStopTime(trip.time) + config.TRIP_HVAC_ON_DURATION;

        if (on) {
          if (subject.data.climateControl) {
            subject.hvacOn = subject.hvacOn || now;
          } else if (!subject.hvacOn) {
            log(
              LogLevel.Info,
              `${subject.teslaID} starting climate control on ${subject.data.name}`
            );
            await this[AgentAction.ClimateControl](job, {
              data: { id: subject.vehicleUUID, enable: true }
            } as any);
          }
        } else {
          if (!subject.data.climateControl) {
            subject.hvacOff = subject.hvacOff || now;
          } else if (!subject.hvacOff) {
            log(
              LogLevel.Info,
              `${subject.teslaID} stopping climate control on ${subject.data.name}`
            );
            await this[AgentAction.ClimateControl](job, {
              data: { id: subject.vehicleUUID, enable: false }
            } as any);
          }
        }
      } else {
        delete subject.hvacOn;
        delete subject.hvacOff;
      }
    } catch (err) {
      if (config.AGENT_SAVE_TO_TRACEFILE) {
        const s = logFormat(LogLevel.Error, err);
        fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, { flag: "as" });
      }
      // this.changePollstate(subject, "offline");
      // this.adjustInterval(job, 10); // Try again

      // TODO: handle different errors?
      if (err.code === 401) {
        log(
          LogLevel.Trace,
          `${
            subject.teslaID
          } tesla-agent polling error 401 for ${JSON.stringify(
            job.serviceData
          )}`
        );
        try {
          const newToken = await this.scClient.providerMutate("tesla", {
            mutation: TeslaProviderMutates.RefreshToken,
            refresh_token: job.serviceData.token.refresh_token
          });
          delete job.serviceData.invalid_token; // client side update to match server
          job.serviceData.token = newToken; // client side update to match server
        } catch (err) {
          log(
            LogLevel.Error,
            `${subject.teslaID} unable to refresh teslaAPI token for ${
              subject.teslaID
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
          `${subject.teslaID} ${JSON.stringify(err.response.data)}`
        );
        if (err.response.data.error) {
          await this.setStatus(subject, err.response.data.error);
        }
      } else {
        log(LogLevel.Error, `${subject.teslaID} ${JSON.stringify(err)}`);
      }
      throw new Error(err);
    }
  }

  public async serviceWork(job: TeslaAgentJob) {
    if (job.serviceData.invalid_token) return; // provider requires a valid token

    if (
      !job.mapped ||
      (job.serviceData.updated && job.mapped < job.serviceData.updated)
    ) {
      job.state = {};
      const list = await this.scClient.providerQuery("tesla", {
        query: TeslaProviderQueries.Vehicles,
        service_uuid: job.serviceID
      });
      for (const v of list) {
        if (v.vehicle_uuid && !job.state[v.vehicle_uuid]) {
          job.state[v.vehicle_uuid] = {
            vehicleUUID: v.vehicle_uuid,
            teslaID: v.id_s,
            online: false,
            pollstate: undefined,
            statestart: Date.now(),
            status: ""
          };
          log(
            LogLevel.Debug,
            `Service ${job.serviceID} mapping VIN ${v.vin} -> ID ${v.id_s} -> UUID ${v.vehicle_uuid}`
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
        return this.vehicleInteraction(job, subject, true);
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
        if (!(await this.vehicleInteraction(job, subject, true))) return false; // Not ready for interaction
        if (subject.data && subject.data.climateControl === action.data.enable)
          return true; // Already correct

        if (action.data.enable) {
          await teslaAPI.climateOn(subject.teslaID, job.serviceData.token);
        } else {
          await teslaAPI.climateOff(subject.teslaID, job.serviceData.token);
        }
      }
    }
    return false;
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new TeslaAgent(scClient)
};
export default agent;
