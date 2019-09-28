/* eslint-disable require-atomic-updates */
/**
 * @file TeslaAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { IRestToken, RestClient } from "@shared/restclient";
import * as fs from "fs";
import { log, logFormat, LogLevel } from "@shared/utils";
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
  Vehicle,
  UpdateVehicleDataInput,
  ChargeConnection,
  ChargePlan,
  ChargeType,
  Action
} from "@server/gql/vehicle-type";

type PollState = "polling" | "tired" | "offline" | "asleep";

interface TeslaSubject {
  teslaID: string;
  vehicleUUID: string;
  data?: Vehicle;
  online: boolean;
  pollstate: PollState | undefined;
  statestart: number;
  status: string;
  keepAwake?: number; // last event where we wanted to stay awake
  debugSleep?: any;
  chargeLimit?: number;
  chargeEnabled?: boolean;
  portOpen?: boolean;
  parked?: number;
  triedOpen?: number;
  hvacOn?: number;
  hvacOff?: number;
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
    if (subject.data === undefined || subject.data.providerData === undefined)
      return;
    if (data === undefined || data.vehicle_config === undefined) return;

    /***** No option codes are correct from the API, so I make my own *****/

    const config = data.vehicle_config;
    let option_codes = [];
    let defaults: any;

    switch (config.car_type) {
      case "models":
      case "models2":
        option_codes.push(config.car_type === "models2" ? "MI03" : "MI01");
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
        SilverMetallic: "PMSS"
      })
    );

    option_codes.push(
      optionTranslate("roof_color", {
        Glass: defaults.roof_color,
        None: defaults.roof_color
        // TODO: Add more information
        // Glass: "RF3G" (default)
      })
    );

    option_codes.push(
      optionTranslate("wheel_type", {
        Pinwheel18: "W38B",
        Stiletto19: "W39B",
        Slipstream19Carbon: "WTDS",
        Turbine22Dark: "WT20"
        // TODO: Add more information
        // 20" Sport Wheels: "W32B"
      })
    );

    option_codes.push(
      optionTranslate("spoiler_type", {
        Passive: "X021",
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
      JSON.stringify(subject.data.providerData.option_codes) !==
        JSON.stringify(option_codes)
    ) {
      await this.scClient.updateVehicle({
        id: subject.vehicleUUID,
        providerData: { car_type: config.car_type, option_codes: option_codes }
      });
    }
  }

  // Check token and refresh through server provider API
  public async maintainToken(job: TeslaAgentJob) {
    // API Token check and update
    let token = job.serviceData.token as IRestToken;
    if (RestClient.tokenExpired(token)) {
      // Token has expired, run it through server
      let token = job.serviceData.token as IRestToken;
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
        timestamp: new Date(),
        data: subject.debugSleep
      });
    }
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
      this.changePollstate(subject, "polling"); // break tired cycle
      this.adjustInterval(job, 0); // poll directly after an interaction
      return true;
    }
    this.adjustInterval(job, 5); // poll more often after an interaction
    return false;
  }

  private async poll(job: TeslaAgentJob, subject: TeslaSubject): Promise<void> {
    try {
      const now = Date.now();
      await this.maintainToken(job);

      const timeTryingToSleep =
        (subject.data && subject.data.providerData.time_tired) ||
        config.TIME_BEING_TIRED;

      // API Poll
      if (
        subject.pollstate === "polling" || // Poll vehicle data if we are in polling state
        (subject.pollstate === "tired" &&
          now >= subject.statestart + timeTryingToSleep) // or if we've been trying to sleep for TIME_BEING_TIRED seconds
      ) {
        const data = (await teslaAPI.getVehicleData(
          subject.teslaID,
          job.serviceData.token
        )).response;
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
        const input: UpdateVehicleDataInput = {
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
            ? ChargeConnection.dc // fast charger
            : data.charge_state.charging_state !== "Disconnected"
            ? ChargeConnection.ac
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
                timestamp: new Date(),
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
          this.changePollstate(subject, "polling"); // Keep active polling
          subject.keepAwake = now + config.TIME_BEFORE_TIRED;
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
        const data = (await teslaAPI.listVehicle(
          subject.teslaID,
          job.serviceData.token
        )).response;
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
                `${subject.teslaID} ${data.display_name} is ${data.state} (${
                  subject.pollstate
                } -> polling)`
              );
              this.changePollstate(subject, "polling");
              this.adjustInterval(job, 0); // Woke up, poll right away
              subject.keepAwake = now + config.TIME_BEFORE_TIRED; // Something woke it up, so keep it awake for a while
              return;
            }
            break;
          case "offline":
            if (subject.pollstate !== "offline") {
              log(
                LogLevel.Info,
                `${subject.teslaID} ${data.display_name} is ${data.state} (${
                  subject.pollstate
                } -> offline)`
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
                `${subject.teslaID} ${data.display_name} is ${data.state} (${
                  subject.pollstate
                } -> asleep)`
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

      if (
        subject.data &&
        subject.data.providerData &&
        subject.data.providerData.invalid_token
      ) {
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
      /*console.log(
        JSON.stringify({
          wasDriving: wasDriving,
          parked: subject.parked,
          triedOpen: subject.triedOpen,
          now: now,
          plan: subject.data.chargePlan !== null
        })
      );
      console.log(JSON.stringify(subject));*/
      log(LogLevel.Trace, `${subject.teslaID} ${JSON.stringify(subject)}`);

      // Command logic
      assert(subject.data !== undefined);
      if (
        (!subject.data.pausedUntil ||
          now >= subject.data.pausedUntil.getTime()) && // Only controll if not paused
        subject.data.location !== null
      ) {
        // Only controll if at a known charging location

        if (subject.data.isConnected) {
          // controll if car is connected
          let shouldCharge: ChargePlan | null = null;
          if (subject.data.chargePlan) {
            for (const p of subject.data.chargePlan) {
              if (
                (p.chargeStart === null || now >= p.chargeStart.getTime()) &&
                (p.chargeStop === null || now < p.chargeStop.getTime())
              ) {
                shouldCharge = p;
              }
            }
          }

          if (
            shouldCharge === null &&
            subject.online &&
            subject.chargeEnabled === true &&
            subject.data.chargingTo !== null &&
            subject.data.batteryLevel < subject.data.chargingTo // keep it running if we're above or on target
          ) {
            if (await this.vehicleInteraction(job, subject, false)) {
              log(
                LogLevel.Info,
                `${subject.teslaID} stop charging ${subject.data.name}`
              );
              teslaAPI.chargeStop(subject.teslaID, job.serviceData.token);
              this.changePollstate(subject, "polling"); // break tired cycle on model S and X so we can verify charging is disabled
            }
          } else if (
            shouldCharge !== null &&
            subject.data.batteryLevel < shouldCharge.level
          ) {
            if (subject.chargeEnabled !== true) {
              if (await this.vehicleInteraction(job, subject, true)) {
                log(
                  LogLevel.Info,
                  `${subject.teslaID} start charging ${subject.data.name}`
                );
                await teslaAPI.chargeStart(
                  subject.teslaID,
                  job.serviceData.token
                );
                this.changePollstate(subject, "polling"); // break tired cycle on model S and X so we can verify charging is enabled
              }
            } else {
              let setLevel = shouldCharge!.level;
              if (shouldCharge!.chargeType === ChargeType.calibrate) {
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
                subject.chargeLimit !== chargeto
              ) {
                if (await this.vehicleInteraction(job, subject, true)) {
                  log(
                    LogLevel.Info,
                    `${subject.teslaID} setting charge limit for ${
                      subject.data.name
                    } to ${chargeto}%`
                  );
                  await teslaAPI.setChargeLimit(
                    subject.teslaID,
                    chargeto,
                    job.serviceData.token
                  );
                  this.changePollstate(subject, "polling"); // break tired cycle on model S and X so we can verify change of charge limit
                }
              }
            }
          }
        } else if (
          subject.data.providerData &&
          subject.data.providerData.auto_port &&
          subject.parked !== undefined &&
          subject.data.chargePlan &&
          subject.data.chargePlan.findIndex(
            f =>
              f.chargeType !== ChargeType.fill &&
              f.chargeType !== ChargeType.prefered
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

        // Should we turn on hvac?
        if (
          subject.data.providerData &&
          subject.data.providerData.auto_hvac &&
          subject.data.tripSchedule
        ) {
          const on =
            now >
              subject.data.tripSchedule.time.getTime() -
                config.TRIP_HVAC_ON_WINDOW &&
            now <
              subject.data.tripSchedule.time.getTime() +
                config.TRIP_HVAC_ON_DURATION;

          if (on) {
            if (subject.data.climateControl) {
              subject.hvacOn = subject.hvacOn || now;
            } else if (!subject.hvacOn) {
              log(
                LogLevel.Info,
                `${subject.teslaID} starting climate control on ${
                  subject.data.name
                }`
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
                `${subject.teslaID} stopping climate control on ${
                  subject.data.name
                }`
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
            `Service ${job.serviceID} mapping VIN ${v.vin} -> ID ${
              v.id_s
            } -> UUID ${v.vehicle_uuid}`
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
    action: Action
  ): Promise<any> {
    for (const subject of Object.values(job.state)) {
      if (subject.vehicleUUID === action.data.id) {
        return this.vehicleInteraction(job, subject, true);
      }
    }
  }
  public async [AgentAction.ClimateControl](
    job: TeslaAgentJob,
    action: Action
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
