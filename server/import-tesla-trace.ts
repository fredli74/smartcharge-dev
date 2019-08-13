#!/usr/bin/env node

/**
 * @file Utility to import tesla data from an old trace file
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 * @description I used this utility for testing
 */

import fs from "fs";
import { delay, LogLevel, setLogLevel } from "@shared/utils";
import { Logic } from "./logic";
import { DBInterface } from "./db-interface";
import { ChargeConnection, UpdateVehicleDataInput } from "./gql/vehicle-type";

if (process.argv.length < 3) {
  console.log(`Missing argument`);
  process.exit(-1);
}
const tracefile = process.argv[2];

const db = new DBInterface();
const logic = new Logic(db);

const lines = fs.readFileSync(tracefile, "utf-8").split("\n");

setLogLevel(LogLevel.Debug);

const vid: { [id: string]: string } = {};

(async () => {
  for await (const line of lines) {
    const match = line.match(/^([0-9\-T:Z.]+) \? ({.*charge_state.*})$/);
    if (match !== null) {
      const now = new Date(match[1]);
      const data = JSON.parse(match[2]);

      if (vid[data.id_s] === undefined) {
        // eslint-disable-next-line require-atomic-updates
        vid[data.id_s] = (await db.pg.one(
          `SELECT data->>'vehicle' vehicle_uuid FROM provider WHERE data->>'sid' = $1`,
          data.id_s
        )).vehicle_uuid;
      }
      const job = { subjectID: vid[data.id_s] };

      //
      // COPY OF tesla_agent.ts CODE
      // --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< ---

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

      //  await this.scClient.updateVehicleData(input);
      //
      // --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< --- 8< ---
      //
      await logic.updateVehicleData(input, now);

      console.debug(
        `${now.toISOString()} ${JSON.stringify({
          driving: input.isDriving,
          connected: input.connectedCharger,
          charging: input.chargingTo,
          level: input.batteryLevel,
          odometer: input.odometer,
          temp: input.outsideTemperature,
          power: input.powerUse,
          added: input.energyAdded
        })}`
      );
      await delay(10);
    }
  }
})();
