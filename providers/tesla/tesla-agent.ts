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
import { TeslaProviderData } from "./app/tesla-helper";
import provider from ".";
import {
  Vehicle,
  UpdateVehicleDataInput,
  ChargeConnection,
  ChargePlan,
  ChargeType,
  Action
} from "@server/gql/vehicle-type";

type PollState = "polling" | "tired" | "offline" | "asleep";

interface TeslaAgentJob extends AgentJob {
  providerData: TeslaProviderData;
  state: {
    data?: Vehicle;
    online: boolean;
    pollstate: PollState;
    statestart: number;
    status: string;
    debugSleep?: any;
    chargeLimit?: number;
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
  };
}

export class TeslaAgent extends AbstractAgent {
  public name: string = provider.name;
  constructor(scClient: SCClient) {
    super(scClient);
  }

  public newState() {
    return {
      online: false,
      pollstate: "offline",
      statestart: Date.now(),
      status: ""
    };
  }
  private changePollstate(job: TeslaAgentJob, state: PollState) {
    if (job.state.pollstate === state) return;
    job.state.pollstate = state;
    job.state.statestart = Date.now();
    job.state.online = state !== "offline" && state !== "asleep";
  }

  public async setStatus(job: TeslaAgentJob, status: string) {
    if (job.state && job.state.status !== status) {
      this.scClient.updateVehicle({ id: job.subjectID, status: status });
      job.state.status = status;
    }
  }

  public async setOptionCodes(job: TeslaAgentJob, data: any) {
    let option_codes = (data.option_codes as string).split(",");
    if (option_codes.indexOf("MDL3") >= 0) {
      /***** MODEL 3 option codes are not correct *****/
      option_codes = [];
      if (data.vehicle_config === undefined) return;

      // Add new codes
      const colors: any = {
        MidnightSilver: "PMNG",
        DeepBlue: "PPSB"
        // TODO: Add more information
        // Solid Black: "PBSB",
        // Red Multi-Coat : "PPMR",
        // Pearl White Multi-Coat : "PPSW",
        // Silver Metallic : "PMSS",
      };
      option_codes.push(colors[data.vehicle_config.exterior_color] || "PPSW");

      const roofColors: any = {
        Glass: "RF3G"
        // TODO: Add more information
      };
      option_codes.push(roofColors[data.vehicle_config.roof_color] || "RF3G");

      const wheels: any = {
        Pinwheel18: "W38B",
        Stiletto19: "W39B"
        // TODO: Add more information
        // 19" Sport Wheels: "W39B", // default
        // 20" Sport Wheels: "W32B"
      };
      option_codes.push(wheels[data.vehicle_config.wheel_type] || "W38B");

      if (data.vehicle_config.spoiler_type !== "None") {
        option_codes.push("SLR1");
      }

      option_codes.push(data.vehicle_config.rhd ? "DRRH" : "DRLH");
    }

    if (
      JSON.stringify(job.providerData.option_codes) !==
      JSON.stringify(option_codes)
    ) {
      await this.scClient.updateVehicle({
        id: job.subjectID,
        providerData: { option_codes: option_codes }
      });
    }
  }

  public async maintainToken(job: TeslaAgentJob) {
    // API Token check and update
    let token = job.providerData.token as IRestToken;

    if (RestClient.tokenExpired(token)) {
      // Token has expired, run it through server
      const newToken = await this.scClient.providerMutate("tesla", {
        mutation: "refreshToken",
        token
      });
      for (const j of Object.values(this.subjects)) {
        if (
          (j as TeslaAgentJob).providerData.token.refresh_token ===
          token.refresh_token
        ) {
          (j as TeslaAgentJob).providerData.token = newToken;
        }
      }
      assert(job.providerData.token.access_token === newToken.access_token);
    }
  }

  public async update(job: TeslaAgentJob): Promise<void> {
    if (job.providerData.invalid_token) return; // provider requires a valid token

    const now = Date.now();
    try {
      await this.maintainToken(job);

      // API Poll
      if (
        job.state.pollstate === "polling" || // Poll vehicle data if we are in polling state
        (job.state.pollstate === "tired" &&
          now >= job.state.statestart + config.TIME_BEING_TIRED) // or if we've been trying to sleep for TIME_BEING_TIRED seconds
      ) {
        const data = (await teslaAPI.getVehicleData(
          job.providerData.sid,
          job.providerData.token
        )).response;
        if (config.AGENT_SAVE_TO_TRACEFILE) {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as"
          });
        }

        job.state.chargeLimit = data.charge_state.charge_limit_soc;
        job.state.portOpen = data.charge_state.charge_port_door_open;
        job.state.online = true;

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
          id: job.subjectID,
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

        // Set status
        if (input.chargingTo) {
          await this.setStatus(job, "Charging"); // We are charging
          this.changePollstate(job, "polling"); // Keep active polling when charging
          this.adjustInterval(job, 10); // Poll more often when charging
        } else if (input.isDriving) {
          await this.setStatus(job, "Driving"); // We are driving
          this.changePollstate(job, "polling"); // Keep active polling when driving
          this.adjustInterval(job, 10); // Poll more often when driving
        } else {
          this.adjustInterval(job, 60);
          let insomnia = false; // Are we in a state where sleep is not possible

          if (data.vehicle_state.is_user_present) {
            await this.setStatus(job, "Idle (user present)");
            insomnia = true;
          } else if (data.climate_state.climate_keeper_mode === "dog") {
            await this.setStatus(job, "Idle (dog mode on)");
            insomnia = true;
          } else if (data.climate_state.is_climate_on) {
            await this.setStatus(job, "Idle (climate on)");
            insomnia = true;
          } else if (data.vehicle_state.sentry_mode) {
            await this.setStatus(job, "Idle (sentry on)");
            insomnia = true;
          } else if (job.state.pollstate === "tired") {
            if (job.state.debugSleep !== undefined) {
              job.state.debugSleep.now = now;
              job.state.debugSleep.success = false;
              await this.scClient.vehicleDebug({
                id: job.subjectID,
                category: "sleep",
                timestamp: new Date(),
                data: job.state.debugSleep
              });
              job.state.debugSleep.info = data;
            }
            job.state.statestart = now; // Reset state start to only poll once every TIME_BEING_TIRED
          } else if (now >= job.state.statestart + config.TIME_BEFORE_TIRED) {
            await this.setStatus(job, "Waiting to sleep"); // We were idle for TIME_BEFORE_TIRED
            this.changePollstate(job, "tired");
            job.state.debugSleep = {
              now: now,
              start: now,
              success: false,
              info: data
            }; // Save current state to debug sleep tries
          } else {
            await this.setStatus(job, "Idle");
          }

          if (insomnia) {
            this.changePollstate(job, "polling");
          }
        }
        await this.scClient.updateVehicleData(input);
        await this.setOptionCodes(job, data);

        // Charge calibration
        if (
          job.state.calibrating &&
          powerUse > 0 &&
          now > job.state.calibrating.next
        ) {
          const thisLimit = data.charge_state.charge_limit_soc;
          const lastLimit = job.state.calibrating.level;
          const levelNow = data.charge_state.usable_battery_level;
          if (thisLimit <= levelNow) {
            job.state.calibrating.level = levelNow;
            job.state.calibrating.duration = 0;
          } else if (thisLimit > lastLimit) {
            const thisTime = data.charge_state.time_to_full_charge * 3600;
            const lastDuration = job.state.calibrating.duration;
            let duration = thisTime / (thisLimit - levelNow);

            if (lastDuration > 0 && levelNow < lastLimit) {
              const lastTime =
                (lastLimit - levelNow) * job.state.calibrating.duration;
              duration = Math.max(
                duration,
                (thisTime - lastTime) / (thisLimit - lastLimit)
              );
            }
            job.state.calibrating.level = thisLimit;
            job.state.calibrating.duration = duration;
            await this.scClient.chargeCalibration(
              job.subjectID,
              job.state.calibrating.level,
              Math.round(job.state.calibrating.duration),
              powerUse
            );
          }
        }

        if (
          job.state.hvacOn &&
          (data.climate_state.climate_keeper_mode !== "off" ||
            data.climate_state.smart_preconditioning ||
            data.drive_state.shift_state !== "P" ||
            data.vehicle_state.is_user_present ||
            data.vehicle_state.df > 0 ||
            data.vehicle_state.dr > 0 ||
            data.vehicle_state.pf > 0 ||
            data.vehicle_state.pr > 0 ||
            data.vehicle_state.ft > 0 ||
            data.vehicle_state.rt > 0)
        ) {
          // User has interacted with the car so leave the hvac alone
          delete job.state.hvacOn;
          delete job.state.hvacOff;
        }
      } else {
        // Poll vehicle list to avoid keeping it awake
        const data = (await teslaAPI.listVehicle(
          job.providerData.sid,
          job.providerData.token
        )).response;
        if (config.AGENT_SAVE_TO_TRACEFILE) {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as"
          });
        }

        this.adjustInterval(job, 60);
        switch (data.state) {
          case "online":
            if (
              job.state.pollstate === "asleep" ||
              job.state.pollstate === "offline"
            ) {
              // We were offline or sleeping
              log(
                LogLevel.Info,
                `${data.display_name} is ${data.state} (${
                  job.state.pollstate
                } -> polling)`
              );
              this.changePollstate(job, "polling"); // Start polling again
              this.adjustInterval(job, 0); // Woke up, poll right away
            }
            break;
          case "offline":
            if (job.state.pollstate !== "offline") {
              log(
                LogLevel.Info,
                `${data.display_name} is ${data.state} (${
                  job.state.pollstate
                } -> offline)`
              );

              this.changePollstate(job, "offline");
              await this.setStatus(job, "Offline");
            }
            break;
          case "asleep":
            if (job.state.pollstate !== "asleep") {
              log(
                LogLevel.Info,
                `${data.display_name} is ${data.state} (${
                  job.state.pollstate
                } -> asleep)`
              );

              this.changePollstate(job, "asleep");
              await this.setStatus(job, "Sleeping");

              if (job.state.debugSleep !== undefined) {
                job.state.debugSleep.now = now;
                job.state.debugSleep.success = true;
                await this.scClient.vehicleDebug({
                  id: job.subjectID,
                  category: "sleep",
                  timestamp: new Date(),
                  data: job.state.debugSleep
                });
              }
            }
            break;
          default: {
            const s = logFormat(
              LogLevel.Error,
              `unknown state: ${JSON.stringify(data)}`
            );
            fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
              flag: "as"
            });
            console.error(s);
          }
        }
        await this.setOptionCodes(job, data);
      }

      const wasDriving = Boolean(job.state.data && job.state.data.isDriving);
      job.state.data = await this.scClient.getVehicle(job.subjectID);
      job.providerData = job.state.data.providerData; // update local copy of providerData

      if (job.state.data.isDriving) {
        job.state.triedOpen = undefined;
        job.state.parked = undefined;
      } else if (wasDriving) {
        assert(job.state.parked === undefined);
        job.state.parked = now;
      }
      console.log(
        JSON.stringify({
          wasDriving: wasDriving,
          parked: job.state.parked,
          triedOpen: job.state.triedOpen,
          now: now,
          plan: job.state.data.chargePlan !== null
        })
      );
      console.log(JSON.stringify(job.state));

      // Command logic
      assert(job.state.data !== undefined);
      if (
        (!job.state.data.pausedUntil ||
          now >= job.state.data.pausedUntil.getTime()) && // Only controll if not paused
        job.state.data.location !== null
      ) {
        // Only controll if at a known charging location

        if (job.state.data.isConnected) {
          // controll if car is connected
          let shouldCharge: ChargePlan | null = null;
          if (job.state.data.chargePlan) {
            for (const p of job.state.data.chargePlan) {
              if (
                (p.chargeStart === null || now >= p.chargeStart.getTime()) &&
                (p.chargeStop === null || now < p.chargeStop.getTime())
              ) {
                shouldCharge = p;
              }
            }
          }
          console.debug(
            job.state.data.batteryLevel +
              " " +
              JSON.stringify(job.state.data.chargePlan)
          );

          let stopCharging = false;
          let startCharging = false;
          if (
            shouldCharge === null &&
            job.state.data.chargingTo !== null &&
            job.state.data.batteryLevel < job.state.data.chargingTo
          ) {
            stopCharging = true;
          } else if (
            shouldCharge !== null &&
            job.state.data.batteryLevel < shouldCharge.level
          ) {
            startCharging = true;
          }
          if (stopCharging || startCharging) {
            if (!(await this.userInteraction(job))) {
              log(
                LogLevel.Trace,
                `Waiting for vehicle ${job.subjectID} to be ready`
              );
            } else if (stopCharging) {
              log(LogLevel.Info, `Stop charging ${job.state.data.name}`);
              teslaAPI.chargeStop(job.providerData.sid, job.providerData.token);
            } else if (startCharging) {
              let setLevel = shouldCharge!.level;
              if (shouldCharge!.chargeType === ChargeType.calibrate) {
                if (!job.state.calibrating) {
                  job.state.calibrating = {
                    level:
                      (await this.scClient.chargeCalibration(
                        job.subjectID,
                        undefined,
                        undefined,
                        undefined
                      )) || job.state.data.batteryLevel,
                    duration: 0,
                    next: now + 30e3
                  };
                }
                if (job.state.calibrating.level === shouldCharge!.level) {
                  // done!
                  setLevel = 0;
                } else {
                  setLevel = job.state.calibrating.level + 1;
                  if (job.state.chargeLimit !== setLevel) {
                    job.state.calibrating.next = Math.max(
                      now + 15e3,
                      job.state.calibrating.next
                    );
                  }
                }
              } else if (job.state.calibrating) {
                delete job.state.calibrating;
              }

              const chargeto = Math.max(50, setLevel); // Minimum allowed charge for Tesla is 50

              if (
                job.state.chargeLimit !== undefined && // Only controll if polled at least once
                job.state.chargeLimit !== chargeto
              ) {
                log(
                  LogLevel.Info,
                  `Setting charge limit for ${
                    job.state.data.name
                  } to ${chargeto}%`
                );
                await teslaAPI.setChargeLimit(
                  job.providerData.sid,
                  chargeto,
                  job.providerData.token
                );
              }
              if (job.state.data.chargingTo === null) {
                log(LogLevel.Info, `Start charging ${job.state.data.name}`);
                await teslaAPI.chargeStart(
                  job.providerData.sid,
                  job.providerData.token
                );
              }
            }
          }
        } else if (
          job.state.data.providerData &&
          job.state.data.providerData.auto_port &&
          job.state.parked !== undefined &&
          job.state.data.chargePlan &&
          job.state.data.chargePlan.findIndex(
            f =>
              f.chargeType !== ChargeType.fill &&
              f.chargeType !== ChargeType.prefered
          ) >= 0
        ) {
          if (
            now < job.state.parked + 1 * 60e3 && // only open during the first minute
            !job.state.portOpen &&
            job.state.triedOpen === undefined
          ) {
            // if port is closed and we did not try to open it yet
            await teslaAPI.openChargePort(
              job.providerData.sid,
              job.providerData.token
            );
            job.state.triedOpen = now;
          } else if (
            now > job.state.parked + 3 * 60e3 && // keep port open for 3 minutes
            job.state.portOpen &&
            job.state.triedOpen !== undefined
          ) {
            await teslaAPI.closeChargePort(
              job.providerData.sid,
              job.providerData.token
            );
            job.state.triedOpen = undefined;
          }
        }

        // Should we turn on hvac?
        if (
          job.state.data.providerData &&
          job.state.data.providerData.auto_hvac &&
          job.state.data.tripSchedule
        ) {
          const on =
            now >
              job.state.data.tripSchedule.time.getTime() -
                config.TRIP_HVAC_ON_WINDOW &&
            now <
              job.state.data.tripSchedule.time.getTime() +
                config.TRIP_HVAC_ON_DURATION;

          if (on) {
            if (job.state.data.climateControl) {
              job.state.hvacOn = job.state.hvacOn || now;
            } else if (!job.state.hvacOn) {
              log(
                LogLevel.Info,
                `Starting climate control on ${job.state.data.name}`
              );
              await this[AgentAction.ClimateControl](job, {
                data: { enable: true }
              } as any);
            }
          } else if (job.state.hvacOn) {
            if (!job.state.data.climateControl) {
              delete job.state.hvacOn;
              delete job.state.hvacOff;
            } else if (!job.state.hvacOff) {
              log(
                LogLevel.Info,
                `Stopping climate control on ${job.state.data.name}`
              );
              await this[AgentAction.ClimateControl](job, {
                data: { enable: false }
              } as any);
            }
          }
        } else {
          delete job.state.hvacOn;
          delete job.state.hvacOff;
        }
      }
    } catch (err) {
      await this.handleError(job, err);
      throw new Error(err);
    }
  }
  async handleError(job: TeslaAgentJob, err: any) {
    if (config.AGENT_SAVE_TO_TRACEFILE) {
      const s = logFormat(LogLevel.Error, err);
      fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, { flag: "as" });
    }
    this.changePollstate(job, "offline");
    this.adjustInterval(job, 10); // Try again

    // TODO: handle different errors?
    if (err.code === 401) {
      await this.scClient.updateVehicle({
        id: job.subjectID,
        providerData: { invalid_token: true }
      });
    }

    if (err.response && err.response.data) {
      log(LogLevel.Error, err.response.data);
      if (err.response.data.error) {
        await this.setStatus(job, err.response.data.error);
      }
    } else {
      log(LogLevel.Error, err);
    }
  }

  private async wakeUp(job: TeslaAgentJob): Promise<boolean> {
    if (job.providerData.invalid_token) return false; // provider requires a valid token
    await this.maintainToken(job);
    log(
      LogLevel.Info,
      `Waking up ${(job.state.data && job.state.data.name) || job.subjectID}`
    );
    const data = await teslaAPI.wakeUp(
      job.providerData.sid,
      job.providerData.token
    );
    if (data && data.response && data.response.state === "online") {
      job.state.online = true;
    }
    return job.state.online;
  }
  private async userInteraction(job: TeslaAgentJob): Promise<boolean> {
    this.adjustInterval(job, 0); // poll more often after an interaction

    if (!job.state.online && !(await this.wakeUp(job))) {
      return false; // try again later
    }

    this.changePollstate(job, "polling"); // break tired cycle
    return true;
  }

  public async [AgentAction.Refresh](job: TeslaAgentJob): Promise<any> {
    return this.userInteraction(job);
  }
  public async [AgentAction.ClimateControl](
    job: TeslaAgentJob,
    action?: Action
  ): Promise<any> {
    if (!action || job.providerData.invalid_token) return false; // provider requires a valid token

    if (!(await this.userInteraction(job))) return false; // Not ready for interaction
    if (action.data.enable === job.state.data!.climateControl) return true; // Already correct

    await this.maintainToken(job);
    if (action.data.enable) {
      await teslaAPI.climateOn(job.providerData.sid, job.providerData.token);
    } else {
      await teslaAPI.climateOff(job.providerData.sid, job.providerData.token);
    }
    return false;
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new TeslaAgent(scClient)
};
export default agent;
