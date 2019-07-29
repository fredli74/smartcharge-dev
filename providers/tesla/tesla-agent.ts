/* eslint-disable require-atomic-updates */
/**
 * @file TeslaAPI agent for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { RestClient, RestToken, IRestToken } from "@shared/restclient";
import * as fs from "fs";
import { log, logFormat, LogLevel } from "@shared/utils";
import { AgentJob, AbstractAgent } from "@shared/agent";
import { PROJECT_AGENT } from "@shared/smartcharge-globals";
import { SCClient } from "@shared/gql-client";
import {
  ChargeConnection,
  Vehicle,
  UpdateVehicleDataInput,
  ChargePlan
} from "@shared/gql-types";

import config from "./tesla-config";
import provider from "./index";
import { IProviderAgent } from "@providers/provider-agents";

const APP_NAME = `TeslaAgent`;
const APP_VERSION = `${provider.version}`;
const AGENT_NAME = `tesla`;

interface TeslaAgentJob extends AgentJob {
  data: {
    token: RestToken; // token for API authentication
    sid: string; // tesla vehicle id
    vehicle: string; // smartcharge vehicle uuid
  };
  state?: {
    data?: Vehicle;
    pollstate: "polling" | "tired" | "offline" | "asleep";
    statestart: number;
    status: string;
    debugSleep?: any;
    chargeLimit?: number;
    hvac?: boolean;
    portOpen?: boolean;
    parked?: number;
    triedOpen?: number;
  };
}

export const teslaAPI = new RestClient({
  baseURL: config.TESLA_API_BASE_URL,
  agent: `${PROJECT_AGENT} ${APP_NAME}/${APP_VERSION}`,
  timeout: 120000
});

export class TeslaAgent extends AbstractAgent {
  public name: string = AGENT_NAME;
  constructor(private scClient: SCClient) {
    super();
  }
  public static async authenticate(
    email: string,
    password: string
  ): Promise<RestToken> {
    try {
      return await teslaAPI.getToken("/oauth/token?grant_type=password", {
        grant_type: "password",
        client_id: config.TESLA_CLIENT_ID,
        client_secret: config.TESLA_CLIENT_SECRET,
        email: email,
        password: password
      });
    } catch (error) {
      log(
        LogLevel.Debug,
        `TeslaAgent.Authenticate error: ${error.data.response}`
      );
      throw error;
    }
  }
  public static async maintainToken(
    token: IRestToken
  ): Promise<IRestToken | false> {
    if (typeof token !== "object") {
      throw new Error("invalid token");
    }
    assert(typeof token.access_token === "string");
    assert(token.access_token.length === 64);
    assert(typeof token.refresh_token === "string");
    assert(token.refresh_token!.length === 64);
    if (RestClient.tokenExpired(token)) {
      log(LogLevel.Debug, `token needs renewal`);
      return (await teslaAPI.getToken("/oauth/token?grant_type=refresh_token", {
        grant_type: "refresh_token",
        client_id: config.TESLA_CLIENT_ID,
        client_secret: config.TESLA_CLIENT_SECRET,
        refresh_token: token.refresh_token
      })) as IRestToken;
    } else {
      return false;
    }
  }

  public static async wakeUp(id: string, token: RestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/wake_up`,
      undefined,
      token
    );
    log(LogLevel.Trace, `wakeUp(${id}) => ${JSON.stringify(result)}`);
  }
  public static async setChargeLimit(
    id: string,
    limit: number,
    token: RestToken
  ) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/set_charge_limit`,
      { percent: limit },
      token
    );
    log(
      LogLevel.Trace,
      `setChargeLimit(${id}, ${limit}) => ${JSON.stringify(result)}`
    );
  }
  public static async chargeStart(id: string, token: RestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_start`,
      undefined,
      token
    );
    log(LogLevel.Trace, `chargeStart(${id}) => ${JSON.stringify(result)}`);
  }
  public static async chargeStop(id: string, token: RestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_stop`,
      undefined,
      token
    );
    log(LogLevel.Trace, `chargeStop(${id}) => ${JSON.stringify(result)}`);
  }
  public static async openChargePort(id: string, token: RestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_port_door_open`,
      undefined,
      token
    );
    log(LogLevel.Trace, `openChargePort(${id}) => ${JSON.stringify(result)}`);
  }
  public static async closeChargePort(id: string, token: RestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/charge_port_door_close`,
      undefined,
      token
    );
    log(LogLevel.Trace, `closeChargePort(${id}) => ${JSON.stringify(result)}`);
  }
  public static async climateOn(id: string, token: RestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_start`,
      undefined,
      token
    );
    log(LogLevel.Trace, `climateOn(${id}) => ${JSON.stringify(result)}`);
  }
  public static async climateOff(id: string, token: RestToken) {
    const result = await teslaAPI.post(
      `/api/1/vehicles/${id}/command/auto_conditioning_stop`,
      undefined,
      token
    );
    log(LogLevel.Trace, `climateOff(${id}) => ${JSON.stringify(result)}`);
  }
  public static async listVehicle(id: string | undefined, token: RestToken) {
    if (id === undefined) {
      return await teslaAPI.get(`/api/1/vehicles`, token);
    } else {
      return await teslaAPI.get(`/api/1/vehicles/${id}`, token);
    }
  }
  public static async getVehicleData(id: string, token: RestToken) {
    return await teslaAPI.get(`/api/1/vehicles/${id}/vehicle_data`, token);
  }

  public async setStatus(job: TeslaAgentJob, status: string) {
    if (job.state && job.state.status !== status) {
      this.scClient.updateVehicle({ id: job.data.vehicle, status: status });
      job.state.status = status;
    }
  }

  public async work(job: TeslaAgentJob): Promise<number> {
    const now = Date.now();
    let interval = 60;

    if (job.state === undefined) {
      job.state = { pollstate: "offline", statestart: now, status: "" };
    }

    try {
      // API Token check and update
      let token = job.data.token as IRestToken;

      const newToken = await TeslaAgent.maintainToken(token); // Check if token has expired
      if (newToken) {
        await this.scClient.updateProvider({
          name: provider.name,
          filter: { token: { refresh_token: token.refresh_token } },
          data: { token: newToken }
        });
        job.data.token = newToken;
      }

      // API Poll
      if (
        job.state.pollstate === "polling" || // Poll vehicle data if we are in polling state
        (job.state.pollstate === "tired" &&
          now >= job.state.statestart + config.TIME_BEING_TIRED)
      ) {
        // or if we've been trying to sleep for TIME_BEING_TIRED seconds

        const data = (await TeslaAgent.getVehicleData(
          job.data.sid,
          job.data.token
        )).response;
        if (config.AGENT_SAVE_TO_TRACEFILE) {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as"
          });
        }

        job.state.chargeLimit = data.charge_state.charge_limit_soc;
        job.state.portOpen = data.charge_state.charge_port_door_open;
        job.state.hvac = data.climate_state.is_climate_on;

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
          id: job.data.vehicle,
          geoLocation: {
            latitude: data.drive_state.latitude,
            longitude: data.drive_state.longitude
          },
          batteryLevel: Math.trunc(data.charge_state.usable_battery_level), // battery level in %
          odometer: Math.trunc(data.vehicle_state.odometer * 1609.344), // 1 mile = 1.609344 km
          outsideTemperature: data.climate_state.outside_temp, // in celcius
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

        if (input.chargingTo) {
          await this.setStatus(job, "Charging"); // We are charging
          job.state.pollstate = "polling"; // Keep active polling when charging
          job.state.statestart = now; // Reset state starts
          interval = 15; // Poll more often when charging
        } else if (input.isDriving) {
          await this.setStatus(job, "Driving"); // We are driving
          job.state.pollstate = "polling"; // Keep active polling when driving
          job.state.statestart = now; // Reset state starts
          interval = 15; // Poll more often when driving
        } else {
          let insomnia = false; // Are we in a state where sleep is not possible

          if (data.vehicle_state.is_user_present) {
            await this.setStatus(job, "Idle (user present)");
            insomnia = true;
          } else if (data.climate_keeper_mode === "dog") {
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
                id: job.data.vehicle,
                category: "sleep",
                timestamp: new Date(),
                data: job.state.debugSleep
              });
              job.state.debugSleep.info = data;
            }
            job.state.statestart = now; // Reset state start to only poll once every TIME_BEING_TIRED
          } else if (now >= job.state.statestart + config.TIME_BEFORE_TIRED) {
            await this.setStatus(job, "Waiting to sleep"); // We were idle for TIME_BEFORE_TIRED
            job.state.pollstate = "tired";
            job.state.statestart = now;
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
            job.state.pollstate = "polling";
            job.state.statestart = now;
          }
        }
        await this.scClient.updateVehicleData(input);
      } else {
        // Poll vehicle list to avoid keeping it awake
        const data = (await TeslaAgent.listVehicle(
          job.data.sid,
          job.data.token
        )).response;
        if (config.AGENT_SAVE_TO_TRACEFILE) {
          const s = logFormat(LogLevel.Trace, data);
          fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, {
            flag: "as"
          });
        }

        switch (data.state) {
          case "online":
            if (
              job.state.pollstate === "asleep" ||
              job.state.pollstate === "offline"
            ) {
              // We were offline or sleeping
              log(
                LogLevel.Info,
                `${data.display_name} is ${data.state} (${job.state.pollstate} -> polling)`
              );

              job.state.pollstate = "polling"; // Start polling again
              job.state.statestart = now;
              interval = 0; // Woke up, poll right away
            }
            break;
          case "offline":
            if (job.state.pollstate !== "offline") {
              log(
                LogLevel.Info,
                `${data.display_name} is ${data.state} (${job.state.pollstate} -> offline)`
              );

              job.state.pollstate = "offline";
              job.state.statestart = now;
              await this.setStatus(job, "Offline");
            }
            break;
          case "asleep":
            if (job.state.pollstate !== "asleep") {
              log(
                LogLevel.Info,
                `${data.display_name} is ${data.state} (${job.state.pollstate} -> asleep)`
              );

              job.state.pollstate = "asleep";
              job.state.statestart = now;
              await this.setStatus(job, "Sleeping");

              if (job.state.debugSleep !== undefined) {
                job.state.debugSleep.now = now;
                job.state.debugSleep.success = true;
                await this.scClient.vehicleDebug({
                  id: job.data.vehicle,
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
      }

      const wasDriving = Boolean(job.state.data && job.state.data.isDriving);
      job.state.data = await this.scClient.getVehicle(job.data.vehicle);

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

          if (
            shouldCharge === null &&
            job.state.data.chargingTo !== null &&
            job.state.data.batteryLevel < job.state.data.chargingTo
          ) {
            log(LogLevel.Info, `Stop charging ${job.state.data.name}`);
            TeslaAgent.chargeStop(job.data.sid, job.data.token);
          } else if (
            shouldCharge !== null &&
            job.state.data.batteryLevel < shouldCharge.level
          ) {
            if (
              job.state.pollstate === "asleep" ||
              job.state.pollstate === "offline"
            ) {
              log(LogLevel.Info, `Waking up ${job.state.data.name}`);
              await TeslaAgent.wakeUp(job.data.sid, job.data.token);
            } else {
              if (job.state.pollstate === "tired") {
                job.state.pollstate = "polling";
              }

              const chargeto = Math.max(50, shouldCharge.level); // Minimum allowed charge for Tesla is 50

              if (
                job.state.chargeLimit !== undefined && // Only controll if polled at least once
                job.state.chargeLimit !== chargeto
              ) {
                log(
                  LogLevel.Info,
                  `Setting charge limit for ${job.state.data.name} to ${chargeto}%`
                );
                await TeslaAgent.setChargeLimit(
                  job.data.sid,
                  chargeto,
                  job.data.token
                );
              }
              if (job.state.data.chargingTo === null) {
                log(LogLevel.Info, `Start charging ${job.state.data.name}`);
                await TeslaAgent.chargeStart(job.data.sid, job.data.token);
              }
            }
          }
        } else if (
          job.state.data.chargePlan &&
          job.state.data.batteryLevel < 50 &&
          job.state.parked !== undefined
        ) {
          if (
            now < job.state.parked + 1 * 60e3 && // only open during the first minute
            !job.state.portOpen &&
            job.state.triedOpen === undefined
          ) {
            // if port is closed and we did not try to open it yet
            await TeslaAgent.openChargePort(job.data.sid, job.data.token);
            job.state.triedOpen = now;
          } else if (
            now > job.state.parked + 3 * 60e3 && // keep port open for 3 minutes
            job.state.portOpen &&
            job.state.triedOpen !== undefined
          ) {
            await TeslaAgent.closeChargePort(job.data.sid, job.data.token);
            job.state.triedOpen = undefined;
          }
        }

        if (
          job.state.hvac === false &&
          job.state.data.tripSchedule && // only control hvac if we have a trip
          now >
            job.state.data.tripSchedule.time.getTime() -
              config.HVAC_ON_BEFORE_TRIP && // start hvac before trip
          now <
            job.state.data.tripSchedule.time.getTime() +
              config.HVAC_ON_BEFORE_TRIP
        ) {
          // only keep it on for so long
          log(
            LogLevel.Info,
            `Starting climate control on ${job.state.data.name}`
          );
          await TeslaAgent.climateOn(job.data.sid, job.data.token);
        }
      }
    } catch (err) {
      if (config.AGENT_SAVE_TO_TRACEFILE) {
        const s = logFormat(LogLevel.Error, err);
        fs.writeFileSync(config.AGENT_TRACE_FILENAME, `${s}\n`, { flag: "as" });
      }
      job.state.pollstate = "offline";
      interval = 15; // Try again

      // TODO: handle different errors?
      if (err.response && err.response.data) {
        log(LogLevel.Error, err.response.data);
        if (err.response.data.error) {
          await this.setStatus(job, err.response.data.error);
        }
      } else {
        log(LogLevel.Error, err);
      }
    }
    return interval;
  }
}

const agent: IProviderAgent = {
  ...provider,
  agent: (scClient: SCClient) => new TeslaAgent(scClient)
};
export default agent;
