/**
 * @file Server Logic for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { DBInterface } from "./db-interface.js";
import { DBVehicle, DBCharge, DBChargeCurrent, DBTrip, DBConnected, DBLocationStats, DBStatsMap, DBSchedule, } from "./db-schema.js";
import {
  LogLevel,
  log,
  arrayMean,
  compareStartStopTimes,
  numericStartTime,
  numericStopTime,
  compareStartTimes,
  diffObjects,
  capitalize
} from "@shared/utils.js";
import { UpdateVehicleDataInput, ChargePlan, Schedule, VehicleLocationSettings } from "./gql/vehicle-type.js";
import { SmartChargeGoal, ChargeType, ScheduleType } from "@shared/sc-types.js";
import { MIN_STATS_PERIOD, SCHEDULE_TOPUP_MARGIN } from "@shared/smartcharge-defines.js";

const CHARGE_PRIO: Record<ChargeType, number> = {
  [ChargeType.Disable]: 0,
  [ChargeType.Calibrate]: 1,
  [ChargeType.Minimum]: 2,
  [ChargeType.Manual]: 3,
  [ChargeType.Trip]: 4,
  [ChargeType.Routine]: 5,
  [ChargeType.Prefered]: 6,
  [ChargeType.Fill]: 7,
};

export class Logic {
  constructor(private db: DBInterface) { }
  public init() { }

  public async updateVehicleData(
    input: UpdateVehicleDataInput,
    now: Date = new Date()
  ) {
    // Lookup old record
    const was: DBVehicle = await this.db.getVehicle(undefined, input.id);
    log(LogLevel.Trace, `input: ${JSON.stringify(input)}`);
    log(LogLevel.Trace, `vehicle: ${JSON.stringify(was)}`);

    const vehicle = { ...was };
    let connection: DBConnected | null = null;
    let charge: DBCharge | null = null;

    let doPricePlan = false;

    if (input.geoLocation !== undefined) {
      vehicle.location_micro_latitude = input.geoLocation.latitude * 1e6;
      vehicle.location_micro_longitude = input.geoLocation.longitude * 1e6;
      const location = await this.db.lookupKnownLocation(was.account_uuid, vehicle.location_micro_latitude, vehicle.location_micro_longitude);
      if (location !== null) {
        vehicle.location_uuid = location.location_uuid;
      } else {
        vehicle.location_uuid = null;
      }
    }
    if (input.batteryLevel !== undefined) { vehicle.level = input.batteryLevel; }
    if (input.odometer !== undefined) { vehicle.odometer = input.odometer; }
    if (input.outsideTemperature !== undefined) { vehicle.outside_deci_temperature = input.outsideTemperature * 10; }
    if (input.insideTemperature !== undefined) { vehicle.inside_deci_temperature = input.insideTemperature * 10; }
    if (input.climateControl !== undefined) { vehicle.climate_control = input.climateControl; }
    if (input.isDriving !== undefined) { vehicle.driving = input.isDriving; }
    if (input.chargingTo !== undefined) {
      vehicle.charging_to = input.chargingTo;
      if (!vehicle.charging_to) {
        vehicle.charge_id = null;
      }
    }
    if (input.estimatedTimeLeft !== undefined) { vehicle.estimate = input.estimatedTimeLeft; }
    if (input.connectedCharger !== undefined) {
      vehicle.connected = input.connectedCharger !== null;
      if (vehicle.connected) {
        // Did we reconnect in the same location? (Trying to solve issue #430)
        // Allow for 200m odometer difference because of fluctuations when moving vehicle
        connection = await this.db.pg.oneOrNone(
          `SELECT * FROM connected 
            WHERE vehicle_uuid = $1 AND location_uuid = $2
              AND ABS(start_odometer - $3) < 200
            ORDER BY connected_id DESC LIMIT 1`,
          [was.vehicle_uuid, vehicle.location_uuid, vehicle.odometer]
        );
        if (!connection) {
          connection = (await this.db.pg.one(
            `INSERT INTO connected($[this:name]) VALUES($[this:csv]) RETURNING *;`,
            {
              vehicle_uuid: was.vehicle_uuid,
              type: input.connectedCharger,
              location_uuid: vehicle.location_uuid,
              start_ts: now,
              start_level: vehicle.level,
              start_odometer: vehicle.odometer,
              end_ts: now,
              end_level: vehicle.level,
              energy_used: 0,
              cost: 0,
              saved: 0,
              connected: true,
            }
          )) as DBConnected;
          log(LogLevel.Debug, `Started connection ${connection.connected_id}`);
          vehicle.connected_id = connection.connected_id;
          if (connection.location_uuid !== null) {
            await this.createNewStats(vehicle, connection.location_uuid);
          }
        } else {
          // Update connection record because we can not guarantee connectedCharger type is correct the first time
          connection = (await this.db.pg.one(
            `UPDATE connected SET type = $1, location_uuid = $2 WHERE connected_id = $3 RETURNING *;`,
            [input.connectedCharger, vehicle.location_uuid, connection.connected_id]
          )) as DBConnected;
          log(LogLevel.Debug, `Reconnected to connection ${connection.connected_id}`);
        }
        doPricePlan = true;
        vehicle.connected_id = connection.connected_id;
        log(LogLevel.Debug, `Vehicle connected (connected_id=${connection.connected_id})`);
      } else {
        // We disconnected
        if (was.connected_id !== null) {
          log(LogLevel.Debug, `Ending connection ${was.connected_id}`);
          await this.db.pg.none(
            `UPDATE connected SET end_ts = $1, end_level = $2, connected = false WHERE connected_id = $3;`,
            [now, vehicle.level, was.connected_id]
          );
          log(LogLevel.Debug, `Vehicle no longer connected (connected_id=${was.connected_id})`);
          vehicle.connected_id = null;
          vehicle.charge_id = null;
        }
      }
      doPricePlan = true;
    }

    const statsDelta = (now.getTime() - was.updated.getTime()) / 1e3;
    const statsData = (statsDelta > 0 && statsDelta < 60 * 60 && (
      was.driving || was.charging_to || was.odometer !== vehicle.odometer || was.level !== vehicle.level
    )) ? {
        vehicle_uuid: was.vehicle_uuid,
        period: MIN_STATS_PERIOD,
        stats_ts: new Date(
          Math.floor(now.getTime() / MIN_STATS_PERIOD) * MIN_STATS_PERIOD
        ),
        minimum_level: vehicle.level,
        maximum_level: vehicle.level,
        driven_seconds: vehicle.driving ? statsDelta : 0,
        driven_meters: was.odometer > 0 ? vehicle.odometer - was.odometer : 0,
        charged_seconds: vehicle.charging_to ? statsDelta : 0,
        charge_energy: 0,
        charge_cost: 0,
        charge_cost_saved: 0,
      } : null;

    if (input.energyAdded) {
      const energyAdded = Math.round(input.energyAdded * 60e3); // kWh to Wm
      if (!connection && vehicle.connected_id !== null) {
        connection = await this.db.pg.oneOrNone(`SELECT * FROM connected WHERE connected_id = $1`, [vehicle.connected_id]);
      }
      if (connection) {
        if (vehicle.charge_id !== null) {
          charge = await this.db.pg.oneOrNone(`SELECT * FROM charge WHERE charge_id = $1`, [vehicle.charge_id]);
        }
        if (charge) {
          // TODO: Why didn't we just use charge.end_added - charge.start_added?
          const deltaAdded = energyAdded - charge.end_added;

          // TODO: What if charge is scheduled, did we even generate a charge entry then or should we go on connected start instead?
          let cost = 0;
          let saved = 0;
          const priceLookup: { price_now: number; price_then: number; } = await this.db.pg.one(
            `WITH wouldve AS (
                  SELECT MIN(b.start_ts) as ts, SUM(a.end_ts - a.start_ts) as duration
                  FROM charge a JOIN connected b ON (a.connected_id = b.connected_id) WHERE b.connected_id = $1
              ), prices AS (
                  SELECT ts, price FROM price_data p JOIN location l ON (l.price_list_uuid = p.price_list_uuid) WHERE location_uuid = $2
              )
              SELECT 
                  (SELECT price FROM prices WHERE ts < $3 ORDER BY ts DESC LIMIT 1) price_now,
                  (SELECT price FROM prices a, wouldve b WHERE a.ts < b.ts+duration ORDER BY a.ts DESC LIMIT 1) price_then;`,
            [vehicle.connected_id, vehicle.location_uuid, new Date(now)]
          );
          if (priceLookup.price_now !== null) {
            cost = Math.round((priceLookup.price_now * deltaAdded) / 60e3); // price in (kWh) * used in (Wm)   Wm / 60e3 => kWh
            if (priceLookup.price_then !== null) {
              saved = Math.round(((priceLookup.price_then - priceLookup.price_now) * deltaAdded) / 60e3);
            }
          }

          log(LogLevel.Debug, `Updating charge ${charge.charge_id} with ${deltaAdded} Wm added`);
          await this.db.pg.none(
            `UPDATE connected SET ($1:name) = ($1:csv) WHERE connected_id=$2;`,
            [{
              energy_used: connection.energy_used + deltaAdded,
              cost: connection.cost + cost,
              saved: connection.saved + saved,
            }, vehicle.connected_id,]
          );

          if (statsData) {
            statsData.charge_cost = cost;
            statsData.charge_cost_saved = saved;
            statsData.charge_energy = deltaAdded;
          }

          if (vehicle.level > charge.start_level) {
            // Ignore first % since integer % lacks precision
            const chargeCurrent: DBChargeCurrent | null = await this.db.pg.oneOrNone(
              `SELECT * FROM charge_current WHERE charge_id = $1;`,
              [charge.charge_id]
            );
            if (!chargeCurrent || vehicle.level > chargeCurrent.start_level) {
              // reached a new level, create charge curve statistics
              doPricePlan = true;
              if (chargeCurrent && vehicle.level === chargeCurrent.start_level + 1) {
                // only 1% changes, or we've been offline and it's unreliable
                const duration = (now.getTime() - chargeCurrent.start_ts.getTime()) / 1e3; // ms / 1000 = s
                const avgPower = arrayMean(chargeCurrent.powers); // Watt
                const used = (avgPower * duration) / 60; // power (W) * time (s) = Ws / 60 = Wm
                const added = energyAdded - chargeCurrent.start_added; // Wm
                const avgTemp = arrayMean(chargeCurrent.outside_deci_temperatures); // deci-celsius
                log(LogLevel.Debug, `Calculated charge curve between ${chargeCurrent.start_level}% and ${vehicle.level}% is ${(used / 60.0).toFixed(2)}kWh in ${(duration / 60.0).toFixed(2)}m`);
                await this.db.setChargeCurve(
                  vehicle.vehicle_uuid, charge.charge_id, chargeCurrent.start_level, duration, avgTemp, used, added);
              }
              await this.db.pg.none(
                `INSERT INTO charge_current(charge_id) SELECT $[charge_id] WHERE NOT EXISTS (SELECT charge_id FROM charge_current WHERE charge_id = $[charge_id]);` +
                `UPDATE charge_current SET start_ts=$[start_ts], start_level=$[start_level], start_added=$[start_added], powers='{}', outside_deci_temperatures='{}' WHERE charge_id = $[charge_id];`,
                {
                  charge_id: charge.charge_id,
                  start_ts: now,
                  start_level: vehicle.level,
                  start_added: energyAdded,
                }
              );
            }
          }
          const chargeUpdate: Partial<DBCharge> = {
            end_ts: now,
            end_level: vehicle.level,
            end_added: energyAdded,
            energy_used: charge.energy_used + deltaAdded,
          };
          if (vehicle.charging_to) chargeUpdate.target_level = vehicle.charging_to;
          if (vehicle.estimate) chargeUpdate.estimate = vehicle.estimate;
          await this.db.pg.none(
            `UPDATE charge SET ($1:name) = ($1:csv) WHERE charge_id=$2;`,
            [chargeUpdate, charge.charge_id]
          );
        } else if (vehicle.charging_to) {
          // New charge, create a charge record
          charge = (await this.db.pg.one(
            `INSERT INTO charge($[this:name]) VALUES($[this:csv]) RETURNING *;`,
            {
              vehicle_uuid: vehicle.vehicle_uuid,
              connected_id: vehicle.connected_id,
              type: connection.type,
              location_uuid: vehicle.location_uuid,
              start_ts: now,
              start_level: vehicle.level,
              start_added: energyAdded,
              target_level: vehicle.charging_to,
              estimate: vehicle.estimate,
              end_ts: now,
              end_level: vehicle.level,
              end_added: energyAdded,
              energy_used: 0,
            }
          )) as DBCharge;
          vehicle.charge_id = charge.charge_id;
          log(LogLevel.Debug, `Started charge ${charge.charge_id}`);
        }
      }
    }

    if (input.energyUsed && vehicle.charge_id !== null) {
      const energyUsed = Math.round(input.energyUsed * 60e3); // kWh to Wm
      // Set start_used if null and end_used always
      const new_charge = await this.db.pg.one(
        `UPDATE charge SET start_used = COALESCE(start_used, $1), end_used = $1 WHERE charge_id=$2 RETURNING *;`,
        [energyUsed, vehicle.charge_id]
      );
      log(LogLevel.Trace, `charge: ${JSON.stringify(new_charge)}`);
    }

    if (input.powerUse && vehicle.charge_id !== null) {
      const new_current = await this.db.pg.oneOrNone(
        `UPDATE charge_current SET powers = array_append(powers, $[power]), outside_deci_temperatures = array_append(outside_deci_temperatures, cast($[outside_temp] as smallint)) WHERE charge_id=$[charge_id] RETURNING *;`,
        {
          charge_id: vehicle.charge_id,
          power: Math.trunc(input.powerUse * 1e3),
          outside_temp: Math.trunc(vehicle.outside_deci_temperature),
        }
      );
      if (new_current) {
        log(LogLevel.Trace, `charge_current: ${JSON.stringify(new_current)}`);
      }
    }

    if (was.charge_id !== null && vehicle.charge_id === null) {
      // We stopped charging
      log(LogLevel.Debug, `Ending charge ${was.charge_id}`);
      await this.db.pg.none(`DELETE FROM charge_current WHERE charge_id=$1;`, [was.charge_id]);
    }

    if (
      vehicle.location_uuid !== was.location_uuid || vehicle.driving !== was.driving ||
      vehicle.odometer !== was.odometer || vehicle.level !== was.level
    ) {
      let trip: DBTrip | null = (vehicle.trip_id !== null) ? await this.db.pg.oneOrNone(
        `SELECT * FROM trip WHERE trip_id = $1`,
        [vehicle.trip_id]
      ) : null;

      if (!trip) {
        if (vehicle.driving) {
          // trip_id should not be null if we are driving
          trip = (await this.db.pg.one(
            `INSERT INTO trip($[this:name]) VALUES($[this:csv]) RETURNING *;`,
            {
              vehicle_uuid: vehicle.vehicle_uuid,
              start_ts: now,
              start_level: vehicle.level,
              start_location_uuid: vehicle.location_uuid,
              start_odometer: vehicle.odometer,
              start_outside_deci_temperature: vehicle.outside_deci_temperature,
              end_ts: now,
              end_level: vehicle.level,
              end_location_uuid: vehicle.location_uuid,
              distance: 0,
            }
          )) as DBTrip;
          vehicle.trip_id = trip.trip_id;
          log(LogLevel.Debug, `Started trip ${trip.trip_id}`);
        }
      } else {
        const distance = vehicle.odometer - trip.start_odometer;
        const traveled = Math.round(distance - trip.distance);
        if (traveled > 0) {
          if (trip.start_location_uuid !== null && trip.distance < 7e3 && distance >= 7e3) {
            // We have left the starting known location on a real trip (crossing the 7 km threshold), clear any manual schedule
            const removed = await this.db.pg.oneOrNone(
              `DELETE FROM schedule WHERE vehicle_uuid = $1 AND schedule_type = $2 RETURNING *;`,
              [vehicle.vehicle_uuid, ScheduleType.Manual]
            );
            if (removed) {
              log(
                LogLevel.Trace,
                `Removed manual schedule for vehicle ${vehicle.vehicle_uuid} after leaving location ${trip.start_location_uuid} on trip ${trip.trip_id} (${distance}m)`
              );
            }
          }
          log(LogLevel.Debug, `Updating trip ${vehicle.trip_id} with ${traveled}m driven`);
          trip = (await this.db.pg.one(
            `UPDATE trip SET ($1:name) = ($1:csv) WHERE trip_id=$2 RETURNING *;`,
            [{
              end_ts: now,
              end_level: vehicle.level,
              end_location_uuid: vehicle.location_uuid,
              distance: distance,
            }, vehicle.trip_id,]
          )) as DBTrip;
        }
        if (!vehicle.driving) {
          let stopTrip = false;
          if (vehicle.location_uuid !== null) {
            // We stopped driving at a location we know
            log(LogLevel.Debug,
              `Vehicle at location ${vehicle.location_uuid} after driving ${trip.distance / 1e3} km, ending trip ${trip.trip_id}`
            );
            stopTrip = true;
            if (trip.distance < 1e3) {
              // totally ignore trips less than 1 km
              log(LogLevel.Debug, `Removing trip ${trip.trip_id}, because it only recorded ${trip.distance} meters`);
              await this.db.pg.none(`DELETE FROM trip WHERE trip_id=$1;`, [
                vehicle.trip_id,
              ]);
            }
          } else if (vehicle.connected) {
            log(LogLevel.Debug, `Vehicle connected after driving ${trip.distance / 1e3} km, ending trip ${trip.trip_id}`);
            stopTrip = true;
          }
          if (stopTrip) {
            vehicle.trip_id = null;
            doPricePlan = true;
          }
        }
        log(LogLevel.Trace, `trip: ${JSON.stringify(trip)}`);
      }
    }

    // Update new values to database
    {
      const update = diffObjects(vehicle, was);
      if (Object.keys(update).length > 0) {
        update.updated = now;
        await this.db.pg.one(`UPDATE vehicle SET ($1:name) = ($1:csv) WHERE vehicle_uuid=$2 RETURNING *;`, [update, was.vehicle_uuid]);
      }
    }

    if (statsData) {
      await Promise.all([
        this.updateStatsMap(statsData, 5), // 5 minute stats bucket
        this.updateStatsMap(statsData, 60), // hourly stats bucket
        this.updateStatsMap(statsData, 24 * 60), // daily stats bucket
      ]);
    }

    if (doPricePlan) {
      await this.refreshChargePlan(was.vehicle_uuid);
    }
  }

  public async updateStatsMap(data: DBStatsMap, period: number) {
    return this.db.pg.one(
      `INSERT INTO state_map($[this:name]) VALUES ($[this:csv])
          ON CONFLICT(vehicle_uuid, period, stats_ts) DO UPDATE SET
              minimum_level=LEAST(state_map.minimum_level, EXCLUDED.minimum_level),
              maximum_level=GREATEST(state_map.maximum_level, EXCLUDED.maximum_level),
              driven_seconds=state_map.driven_seconds + EXCLUDED.driven_seconds,
              driven_meters=state_map.driven_meters + EXCLUDED.driven_meters,
              charged_seconds=state_map.charged_seconds + EXCLUDED.charged_seconds,
              charge_energy=state_map.charge_energy + EXCLUDED.charge_energy,
              charge_cost=state_map.charge_cost + EXCLUDED.charge_cost,
              charge_cost_saved=state_map.charge_cost_saved + EXCLUDED.charge_cost_saved
          RETURNING *;`,
      {
        vehicle_uuid: data.vehicle_uuid,
        period: period,
        stats_ts: new Date(
          Math.floor(data.stats_ts.getTime() / (period * 60e3)) *
          (period * 60e3)
        ),
        minimum_level: data.minimum_level,
        maximum_level: data.maximum_level,
        driven_seconds: data.driven_seconds,
        driven_meters: data.driven_meters,
        charged_seconds: data.charged_seconds,
        charge_energy: data.charge_energy,
        charge_cost: data.charge_cost,
        charge_cost_saved: data.charge_cost_saved,
      }
    );
  }

  public getVehicleLocationSettings(vehicle: DBVehicle | null, location_uuid: string | null): VehicleLocationSettings {
    if (location_uuid && vehicle && vehicle.location_settings && vehicle.location_settings[location_uuid]) {
      return vehicle.location_settings[location_uuid] as VehicleLocationSettings;
    }
    return DBInterface.DefaultVehicleLocationSettings();
  }

  public async createNewStats(
    vehicle: DBVehicle,
    location_uuid: string
  ): Promise<DBLocationStats | null> {
    const level_charge_time: number | null = (
      await this.db.pg.oneOrNone(
        `WITH curves AS (
          SELECT duration FROM charge a JOIN charge_curve b ON (a.charge_id = b.charge_id)
          WHERE a.vehicle_uuid = $1 AND location_uuid = $2
          ORDER BY start_ts desc, level desc
          LIMIT 100
        )
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) as seconds FROM curves`,
        [vehicle.vehicle_uuid, location_uuid]
      )
    ).seconds;

    // Exit if we have never charged here
    if (level_charge_time === null) return null;

    // What is the current weekly average power price
    const avg_prices: {
      price_data_ts: Date | null;
      avg7: number | null;
      avg21: number | null;
    } = await this.db.pg.one(
      `WITH my_price_data AS (
          SELECT p.* FROM price_data p JOIN location l ON (l.price_list_uuid = p.price_list_uuid) WHERE location_uuid = $1
      )
      SELECT
          (SELECT MAX(ts) FROM my_price_data) as price_data_ts,
          (SELECT AVG(price::float) FROM my_price_data WHERE ts >= current_date - interval '7 days') as avg7,
          (SELECT AVG(price::float) FROM my_price_data WHERE ts >= current_date - interval '21 days') as avg21;`,
      [location_uuid]
    );

    // Exit if we have no price data for this location
    if (avg_prices.price_data_ts === null || avg_prices.avg7 === null || avg_prices.avg21 === null) return null;

    let threshold = 1;

    interface HistoryHour {
      hour: Date;
      fraction: number;
      price: number;
      threshold: number;
    }

    interface HistoryMap {
      connected_id: number;
      start_level: number;
      needed: number;
      offsite: boolean;
      hours: HistoryHour[];
    }
    const historyMap: HistoryMap[] = [];

    {
      const history: {
        connected_id: number;
        location_uuid: string;
        start_level: number;
        end_level: number;
        needed: number;
        hour: Date;
        fraction: number;
        price: number;
        threshold: number;
      }[] = await this.db.pg.manyOrNone(
        `WITH my_price_data AS (
        SELECT p.* FROM price_data p JOIN location l ON (l.price_list_uuid = p.price_list_uuid) WHERE location_uuid = $2
      ), my_connected AS (
        SELECT * FROM connected WHERE vehicle_uuid = $1 AND end_ts >= current_date - interval '3 weeks' AND connected = false AND start_ts::date >= (SELECT MIN(ts)::date FROM my_price_data)
      ), connections AS (
        SELECT *, (SELECT a.end_level-b.start_level FROM my_connected b WHERE b.connected_id > a.connected_id ORDER BY connected_id LIMIT 1) as needed
        FROM my_connected a
      ), period AS (
        SELECT generate_series(date_trunc('hour', (SELECT MIN(start_ts) FROM connections)), current_date - interval '1 hour', '1 hour') as hour
      ), week_avg AS (
        SELECT day, (SELECT AVG(price::float) FROM my_price_data WHERE ts >= day - interval '7 days' AND ts < day) as avg7,
        (SELECT AVG(price::float) FROM my_price_data WHERE ts >= day - interval '21 days' AND ts < day) as avg21 FROM
        (SELECT date_trunc('day', hour) as day FROM period GROUP BY 1) as a
      ), connection_map AS (
        SELECT
          connections.connected_id,
          connections.location_uuid,
          connections.start_level,
          connections.end_level,
          connections.needed,
          period.hour,
          LEAST(
            1.0,
            EXTRACT(
              epoch FROM LEAST(period.hour + interval '1 hour', connections.end_ts) -
              GREATEST(period.hour, connections.start_ts)
            ) / 3600
          ) as fraction,
          AVG(my_price_data.price) as price,
          AVG(my_price_data.price) / (week_avg.avg7 + (week_avg.avg7 - week_avg.avg21) / 2) as threshold
        FROM period
        JOIN connections
          ON (period.hour < connections.end_ts AND period.hour + interval '1 hour' > connections.start_ts)
        JOIN my_price_data
          ON (my_price_data.ts >= period.hour AND my_price_data.ts < period.hour + interval '1 hour')
        JOIN week_avg
          ON (week_avg.day = date_trunc('day', period.hour))
        GROUP BY
          connections.connected_id,
          connections.location_uuid,
          connections.start_level,
          connections.end_level,
          connections.needed,
          period.hour,
          connections.start_ts,
          connections.end_ts,
          week_avg.avg7,
          week_avg.avg21
      )
      SELECT * FROM connection_map ORDER BY connected_id,hour;`,
        [vehicle.vehicle_uuid, location_uuid]
      );
      for (const h of history) {
        if (historyMap.length < 1 || historyMap[historyMap.length - 1].connected_id !== h.connected_id) {
          historyMap.push({
            connected_id: h.connected_id,
            start_level: h.start_level,
            needed: h.needed,
            offsite: h.location_uuid !== location_uuid,
            hours: [],
          });
        }
        if (h.location_uuid === location_uuid) {
          historyMap[historyMap.length - 1].hours.push({
            hour: h.hour,
            fraction: h.fraction,
            price: h.price,
            threshold: h.threshold,
          });
        }
      }
    }

    if (historyMap.length > 0) {
      // Charge simulation
      const locationSettings = this.getVehicleLocationSettings(vehicle, location_uuid);
      const minimum_charge = locationSettings.directLevel;
      const maximum_charge = vehicle.maximum_charge;

      const thresholdList = historyMap
        .reduce(
          (p, c) => [...c.hours.map((h) => h.threshold), ...p],
          [] as number[]
        )
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => Number(b) - Number(a));

      const needsum = historyMap.reduce((p, c) => p + c.needed, 0);
      const needavg = needsum / historyMap.length;

      let bestCost = Number.POSITIVE_INFINITY;
      for (const t of thresholdList) {
        let totalCharged = 0;
        let totalCost = 0;
        let lvl = 0;
        let neededLevel = 0;
        for (let i = 0; i < historyMap.length; ++i) {
          if (i < 1 || historyMap[i - 1].offsite) {
            // We charged somewhere else on the way, so reset simulated battery lvl
            lvl = historyMap[i].start_level;
          } else {
            lvl -= historyMap[i - 1].needed;
            if (lvl < historyMap[i].start_level && lvl < minimum_charge / 2) {
              // half of minimum charge is where I draw the line
              lvl = -1;
              break;
            }
          }
          let hours = [...historyMap[i].hours];
          neededLevel = Math.min(100, minimum_charge + (historyMap[i].needed > 0 ? historyMap[i].needed * 1.1 : needavg));

          let smartCharging = false;

          while (hours.length > 0) {
            if (lvl >= minimum_charge && !smartCharging) {
              hours = hours.sort((a, b) => a.threshold - b.threshold);
              smartCharging = true;
            }
            const h = hours.shift()!;
            const charge = Math.max(h.threshold <= t ? maximum_charge - lvl : 0, lvl < neededLevel ? neededLevel - lvl : 0);
            if (charge > 0) {
              const chargeTime = Math.min(3600 * h.fraction, charge * level_charge_time);
              const newLevel = Math.min(100, lvl + chargeTime / level_charge_time);
              totalCharged += newLevel - lvl;
              totalCost += (chargeTime / 3600) * h.price;
              lvl = newLevel;
            }
          }
        }
        const f = totalCost / totalCharged;
        if (lvl > minimum_charge + needavg && f < bestCost * 0.95) {
          bestCost = f;
          threshold = t;
          log(LogLevel.Debug, `Cost simulation ${vehicle.vehicle_uuid} t=${t} => ${f}`);
        }
      }
    }
    return this.db.pg.one(
      `INSERT INTO location_stats($[this:name]) VALUES ($[this:csv]) RETURNING *;`,
      {
        vehicle_uuid: vehicle.vehicle_uuid,
        location_uuid: location_uuid,
        price_data_ts: avg_prices.price_data_ts,
        level_charge_time: Math.round(level_charge_time),
        weekly_avg7_price: Math.round(avg_prices.avg7),
        weekly_avg21_price: Math.round(avg_prices.avg21),
        threshold: Math.round(threshold * 100),
      }
    );
  }

  public async currentStats(vehicle: DBVehicle, location_uuid: string): Promise<DBLocationStats | null> {
    const stats = await this.db.pg.oneOrNone(
      `SELECT s.*, s.price_data_ts = (SELECT MAX(ts) FROM price_data p JOIN location l ON (l.price_list_uuid = p.price_list_uuid) 
      WHERE l.location_uuid = s.location_uuid) as fresh
      FROM location_stats s WHERE vehicle_uuid=$1 AND location_uuid=$2 ORDER BY stats_id DESC LIMIT 1`,
      [vehicle.vehicle_uuid, location_uuid]
    );
    if (stats && stats.fresh) {
      return stats;
    } else {
      return this.createNewStats(vehicle, location_uuid);
    }
  }

  private static cleanupPlan(plan: ChargePlan[]): ChargePlan[] {
    plan.sort((a, b) =>
      compareStartStopTimes(
        a.chargeStart,
        a.chargeStop,
        b.chargeStart,
        b.chargeStop
      ) || CHARGE_PRIO[a.chargeType] - CHARGE_PRIO[b.chargeType]
    );

    function consolidate() {
      for (let i = 0; i < plan.length - 1; ++i) {
        const a = plan[i];
        const b = plan[i + 1];
        if (numericStartTime(b.chargeStart) <= numericStopTime(a.chargeStop)) {
          if (
            a.chargeType === b.chargeType ||
            numericStopTime(b.chargeStop) <= numericStopTime(a.chargeStop)
          ) {
            if (b.level > a.level && a.chargeStop === null && b.chargeStart !== null) {
              // Cut off a free running charge if next charge has higher level
              a.chargeStop = b.chargeStart;
            } else {
              // Merge them
              if (
                numericStopTime(b.chargeStop) > numericStopTime(a.chargeStop)
              ) {
                a.chargeStop = b.chargeStop;
              }
              a.level = Math.max(a.level, b.level);
              plan.splice(i + 1, 1);
              --i;
            }
          } else if (a.level >= b.level) {
            // Push the next segment forward
            b.chargeStart = a.chargeStop;
          } else {
            // Cut off the current segment
            a.chargeStop = b.chargeStart;
          }
        }
      }
    }

    // First pass to remove any overlaps
    consolidate();
    return plan;
  }

  private async setSmartStatus(vehicle: DBVehicle, status: string) {
    if (vehicle.smart_status !== status) {
      await this.db.pg.none(
        `UPDATE vehicle SET smart_status=$1 WHERE vehicle_uuid=$2;`,
        [status, vehicle.vehicle_uuid]
      );
    }
  }

  private async updateAIschedule(
    vehicle_uuid: string,
    before_ts: number | null,
    level: number | null
  ): Promise<null> {
    if (before_ts && level) {
      return this.db.pg.none(
        `WITH upsert AS (UPDATE schedule SET schedule_ts=$3, level=$4 WHERE vehicle_uuid=$1 AND schedule_type = $2 RETURNING *)
      INSERT INTO schedule(vehicle_uuid, schedule_type, schedule_ts, level) SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT * FROM upsert);`,
        [vehicle_uuid, ScheduleType.AI, new Date(before_ts), level]
      );
    } else {
      return this.db.pg.none(
        `DELETE FROM schedule WHERE vehicle_uuid=$1 AND schedule_type=$2;`,
        [vehicle_uuid, ScheduleType.AI]
      );
    }
  }

  private async generateAIschedule(vehicle: DBVehicle, location_uuid: string | null): Promise<{ ts: number; level: number } | null> {
    /*
     ****** ANALYSE AND THINK ABOUT IT!  ******
     */

    const locationSettings = this.getVehicleLocationSettings(vehicle, location_uuid);
    const minimum_charge = locationSettings.directLevel;

    const guess: { charge: number; before: number; } | null = await this.db.pg.oneOrNone(
      `WITH connections AS (
        -- all connections for specific vehicle_uuid and location_uuid
        SELECT connected_id, start_ts, end_ts, connected, LEAST((end_ts-start_ts)/2, interval '8 hours') as duration_limit, end_level-start_level as charged,
          end_level-COALESCE(
            (SELECT start_level FROM connected B WHERE B.vehicle_uuid = A.vehicle_uuid AND B.connected_id > A.connected_id ORDER BY connected_id LIMIT 1),
            (SELECT level FROM vehicle WHERE vehicle.vehicle_uuid = A.vehicle_uuid)) AS used
        FROM connected A WHERE vehicle_uuid = $1 AND location_uuid = $2
      ), ref_time AS (
        -- latest connection time as base reference, or current time if not connected or 24h have passed
        SELECT GREATEST((SELECT MAX(start_ts) FROM connections), NOW() - interval '1 day') AS start_ts,
          -- also setup not_before if owner has guided the AI that a disconnect will not happen before a specific time
          GREATEST(NOW(), $3) as not_before_ts
      ), similar_connections AS ( 
        -- find similar connections in previous data
        SELECT end_ts - series_offset as target_ts,
          (SELECT not_before_ts FROM ref_time)::date + (end_ts - series_offset)::time as remapped_target_ts, *
        FROM (
          -- create a series looking back at the same week day for the past 58 weeks
          SELECT series as series_start_ts, series - (SELECT start_ts FROM ref_time) AS series_offset, (SELECT not_before_ts FROM ref_time)+(series-(SELECT start_ts FROM ref_time)) AS series_not_before_ts
          FROM generate_series((SELECT start_ts FROM ref_time) - interval '58 weeks',(SELECT start_ts FROM ref_time) - interval '1 week', interval '1 week') as series
        ) as s INNER JOIN LATERAL (
          -- join together with the connection that had the closest end_ts
          SELECT * FROM connections
          WHERE end_ts > series_not_before_ts
            AND end_ts < series_not_before_ts + interval '1 week'
            AND end_ts > series_start_ts+duration_limit
            -- only include sessions where the used amount is in the 25th percentile (this was added so that if you just disconnect to move your vehicle, it won't use that one)
            AND used >= (select percentile_cont(0.25) WITHIN GROUP (ORDER BY used) FROM connections)
            -- and where the charge amount was at least half of the 25th percentile (this was added to filter out connections where nothing was charged)
            AND charged > (select percentile_cont(0.25) WITHIN GROUP (ORDER BY charged) FROM connections WHERE charged > 0)/2
          ORDER BY end_ts LIMIT 1
        ) as c ON true
        -- limit to only past 8 weeks of data that we could find
        ORDER BY 1 DESC LIMIT 8 
      ), segmented AS ( 
        -- segment the list into four partitions
        SELECT
          -- roll disconnection times forward 24 hours if we would not have sufficient time to charge
          CASE WHEN GREATEST((SELECT not_before_ts FROM ref_time), (SELECT start_ts FROM ref_time)+duration_limit) >= remapped_target_ts
            THEN remapped_target_ts + interval '1 day' ELSE remapped_target_ts
          END as before, NTILE(4) OVER (ORDER BY target_ts), *
        FROM similar_connections
      )
      SELECT
        GREATEST(
          -- compare how much was used after these charges to the mean average and go with the greatest number
          (SELECT AVG(used) FROM connections WHERE end_ts > current_date - interval '1 week'),
          (SELECT percentile_cont(0.6) WITHIN GROUP (ORDER BY used) as used FROM segmented)
        ) as charge, extract(epoch from before) as before
        FROM segmented
        -- pick the last row in the first partition (not really 25th percentile, but somewhat like it)
        WHERE ntile = 1 ORDER BY before LIMIT 1;
        
        -- we now have a guessed disconnect time and and average usage
      `,
      [
        vehicle.vehicle_uuid,
        location_uuid,
        null /*scheduleMap[ScheduleType.Guide] &&
                  scheduleMap[ScheduleType.Guide].time*/,
      ]
    );

    if (!guess || !guess.before || !guess.charge) {
      // missing data to guess
      log(LogLevel.Debug, `Missing data for smart charging.`);
      return null;
    } else {
      const minimumLevel = Math.min(
        vehicle.maximum_charge,
        Math.round(minimum_charge + guess.charge + 5) // add 5% to avoid spiraling down
      );
      const before = guess.before * 1e3; // epoch to ms
      return { ts: before, level: minimumLevel, };
    }
  }

  private async refreshVehicleChargePlan(vehicle: DBVehicle) {
    log(LogLevel.Trace, `vehicle: ${JSON.stringify(vehicle)}`);

    let location_uuid = vehicle.location_uuid;
    if (location_uuid === null) {
      if (vehicle.connected) {
        // We are connected, but not at a known location
        log(LogLevel.Debug, `Vehicle connected at unknown location`);
      } else if (vehicle.location_micro_latitude && vehicle.location_micro_longitude) {
        const closest = await this.db.lookupClosestLocation(vehicle.account_uuid, vehicle.location_micro_latitude, vehicle.location_micro_longitude);
        if (closest) {
          location_uuid = closest.location.location_uuid;
          log(LogLevel.Debug, `Vehicle at unknown location, closest known location is ${location_uuid} (${closest.distance}m)`);
        }
      }
    }

    const now = Date.now();

    // TODO: Check current vehicle.charge_plan and see if it needs to be recalculated?

    const locationSettings = this.getVehicleLocationSettings(vehicle, location_uuid);
    const minimum_charge = locationSettings.directLevel;

    // Cleanup schedule remove all entries 1 hour after the end time
    const schedule: DBSchedule[] = await this.db.pg.manyOrNone(
      `DELETE FROM schedule WHERE vehicle_uuid = $1 AND schedule_type <> $2 AND schedule_ts + interval '1 hour' < NOW();
      SELECT * FROM schedule WHERE vehicle_uuid = $1;`,
      [vehicle.vehicle_uuid, ScheduleType.Manual]
    );

    // Reduce the array to a map with only the first upcoming event of each type
    const scheduleMap = schedule
      .sort((a, b) => compareStartTimes(a.schedule_ts, b.schedule_ts))
      .reduce((map, obj) => {
        if (map[obj.schedule_type] === undefined) map[obj.schedule_type] = obj;
        return map;
      }, {} as Record<string, Schedule>);
    const manual = scheduleMap[ScheduleType.Manual];
    const trip = scheduleMap[ScheduleType.Trip];

    let startLevel = vehicle.level - 1;

    let chargePlan: ChargePlan[] = [];
    let smartStatus = "";

    if (manual && !manual.level) {
      log(LogLevel.Debug, `Charging disabled until next connection`);
      chargePlan.push({
        chargeStart: null,
        chargeStop: null,
        chargeType: ChargeType.Disable,
        level: 0,
        comment: `charging disabled`,
      });
      smartStatus = `Charging disabled until next plug in`;
    } else {
      type PriceSlot = Readonly<{ from: number; to: number; price: number }>;
      type ChargeWindow = { start: number; stop: number; score: number };

      // Avoid fragmenting charging in cold weather: only split if each segment is >= 60 minutes.
      const MIN_CHARGE_WINDOW_MS = 60 * 60e3;
      // TODO: user configurable per site or vehicle? Schedule splitting: "none/min/max"
      // none = hard cap maxSegments to 1, min = only split if it saves cost (SPLIT_SAVE_FRACTION), max = always split up to maxSegments
      // Require >=10% savings for each additional segment, otherwise stop splitting.
      const SPLIT_SAVE_FRACTION = 0.10;
      // Soft maxPrice behavior:
      // - Penalize slots above maxPrice in the score/average.
      const OVERPRICE_PENALTY_FACTOR = 1.5;
      // - Hard cap: drop any slot above (maxPrice * SOFT_MAXPRICE_CAP_FACTOR).
      const SOFT_MAXPRICE_CAP_FACTOR = 1.5;
      // Price values in DB are stored as integer(price * 1e5) to keep precision.
      const DB_PRICE_SCALE = 1e5;
      const fmtDbPrice = (p: number): string => (p / DB_PRICE_SCALE).toFixed(5);
      const priceToScorePerMs = (price: number, maxPrice?: number): number => {
        return (maxPrice !== undefined && price > maxPrice) ? price * OVERPRICE_PENALTY_FACTOR : price;
      };
      const price_data: { ts: Date; price: number }[] = ( location_uuid && (await this.db.pg.manyOrNone(
        `SELECT ts, price FROM price_data p JOIN location l ON (l.price_list_uuid = p.price_list_uuid) WHERE location_uuid = $1 AND ts >= NOW() - interval '1 hour' ORDER BY ts`,
        [location_uuid]
      ))) || [];
      let duration = 60 * 60e3; // default 1 hour
      let priceAvailable = 0;
      const priceSlots: ReadonlyArray<PriceSlot> = price_data.map((e, i): PriceSlot => {
        const from = e.ts.getTime();
        if (i < price_data.length - 1) {
          duration = price_data[i + 1].ts.getTime() - e.ts.getTime();
        }
        const to = from + duration;
        if (to > priceAvailable) {
          priceAvailable = to;
        }
        return { from, to, price: e.price };
      });

      const chargeCurve = await this.db.getChargeCurve(vehicle.vehicle_uuid, location_uuid);
      const ChargeDuration = (from: number, to: number): number => {
        let sum = 0;
        for (let l = from; l < to; ++l) {
          sum += chargeCurve[Math.max(0, Math.min(100, Math.ceil(l)))] * (l < to ? 1.0 : 0.75); // remove 25% of the last % to not overshoot
        }
        return sum * 1e3;
      };
      let hardStart = now;
      let hardEnd = Number.POSITIVE_INFINITY;
      const softIntents: Array<{
        chargeType: ChargeType;
        comment: string;
        level: number;
        beforeTs?: number;
      }> = [];
      let fillMaxPrice: number | null = null;
      const addSoftIntent = (chargeType: ChargeType, comment: string, level: number, beforeTs?: number) => {
        if (level > vehicle.maximum_charge) {
          if (beforeTs !== undefined) {
            const topupTime = ChargeDuration(vehicle.maximum_charge, level);
            const topupStart = beforeTs - SCHEDULE_TOPUP_MARGIN - topupTime;
            chargePlan.push({
              chargeStart: new Date(topupStart),
              chargeStop: null,
              level,
              chargeType,
              comment: `topping up`,
            });
            hardEnd = Math.min(hardEnd, topupStart);
          }
          level = vehicle.maximum_charge;
        }
        softIntents.push({ chargeType, comment, level, beforeTs });
      };
      const sortSoftIntents = (intents: typeof softIntents): typeof softIntents => {
        return intents.slice().sort((a, b) => CHARGE_PRIO[a.chargeType] - CHARGE_PRIO[b.chargeType]);
      };
      const buildAllocations = (intents: typeof softIntents) => {
        const ordered = sortSoftIntents(intents);
        let prevNeeded = 0;
        const out: Array<{ durationMs: number; chargeType: ChargeType; comment: string; level: number }> = [];
        for (const intent of ordered) {
          const needed = ChargeDuration(startLevel, intent.level);
          const durationMs = Math.max(0, needed - prevNeeded);
          if (durationMs > 0) {
            out.push({ durationMs, chargeType: intent.chargeType, comment: intent.comment, level: intent.level });
            prevNeeded = needed;
          }
        }
        return out;
      };
      const applyWindows = (
        windows: Array<{ start: number; stop: number }>,
        allocations: Array<{ durationMs: number; chargeType: ChargeType; comment: string; level: number }>
      ) => {
        if (!smartStatus && allocations.length > 0) {
          const top = allocations[0];
          smartStatus = `${capitalize(top.chargeType)} charge to ${top.level}% scheduled`;
        }
        const sorted = windows.slice().sort((a, b) => a.start - b.start);
        let i = 0;
        let remaining = allocations.length > 0 ? allocations[0].durationMs : 0;
        for (const w of sorted) {
          let cursor = w.start;
          let windowLeft = w.stop - w.start;
          while (windowLeft > 0 && i < allocations.length) {
            const a = allocations[i];
            const take = Math.min(windowLeft, remaining);
            chargePlan.push({
              chargeStart: new Date(cursor),
              chargeStop: new Date(cursor + take),
              level: a.level,
              chargeType: a.chargeType,
              comment: a.comment,
            });
            cursor += take;
            windowLeft -= take;
            remaining -= take;
            if (remaining <= 0) {
              i++;
              remaining = i < allocations.length ? allocations[i].durationMs : 0;
            }
          }
        }
      };
      const scheduleSoftIntents = () => {
        if (softIntents.length === 0 && fillMaxPrice === null) return;

        let intentDeadline = priceAvailable;
        let intentMaxLevel = startLevel;
        for (const i of softIntents) {
          if (i.beforeTs !== undefined) intentDeadline = Math.min(intentDeadline, i.beforeTs);
          if (i.level > intentMaxLevel) intentMaxLevel = i.level;
        }
        if (intentDeadline >= hardStart) {
          const max = vehicle.maximum_charge;
          const fillWindows = (
            fillMaxPrice === null ? { windows: [], scheduledMs: 0 } :
            planWindows(ChargeDuration(startLevel, max), intentDeadline, fillMaxPrice, `fill:${max}`)
          );
          if (fillWindows.scheduledMs >= ChargeDuration(startLevel, intentMaxLevel)) {
            // We can fill the entire intent with cheap energy
            applyWindows(fillWindows.windows, buildAllocations([ ...softIntents, { chargeType: ChargeType.Fill, comment: `low price`, level: max } ]));
            smartStatus = smartStatus || `Intent charge to ${intentMaxLevel}% scheduled`;
          } else if (intentMaxLevel > startLevel) {
            // We can not fill the entire intent with cheap energy, so we generate a new plan without maxPrice constraint
            const plan = planWindows(ChargeDuration(startLevel, intentMaxLevel), intentDeadline, undefined, `intent:${intentMaxLevel}`);
            applyWindows(plan.windows, buildAllocations(softIntents));
          }
        } else if (intentMaxLevel > startLevel) {
          // No price data or deadline: charge directly to the max soft intent level.
          const timeNeeded = ChargeDuration(startLevel, intentMaxLevel);
          chargePlan.push({
            chargeStart: null,
            chargeStop: new Date(now + timeNeeded),
            chargeType: softIntents[0]?.chargeType || ChargeType.Fill,
            level: intentMaxLevel,
            comment: softIntents[0]?.comment || `low price`,
          });
        }
      };

      const planWindows = (
        timeNeeded: number,
        before_ts: number,
        maxPrice: number | undefined,
        scheduleTag: string
      ): { windows: { start: number; stop: number }[]; scheduledMs: number } => {
        const scheduled = { windows: [] as { start: number; stop: number }[], scheduledMs: 0 };
        const cap = maxPrice === undefined ? undefined : maxPrice * SOFT_MAXPRICE_CAP_FACTOR;
        const candidates = priceSlots.flatMap((s: PriceSlot): (PriceSlot & { duration: number; score: number })[] => {
          const from = Math.max(s.from, hardStart);
          const to = Math.min(s.to, before_ts, hardEnd);
          if (to <= from) return [];
          // remove segments over hard-cap
          if (cap !== undefined && s.price > cap) return [];
          const duration = to - from;
          const score = priceToScorePerMs(s.price, maxPrice) * duration;
          return [{ from, to, duration, price: s.price, score }];
        });

        if (candidates.length === 0) {
          log(LogLevel.Trace, `scheduleWindows(${scheduleTag}): no segments (no price data?)`);
          return scheduled;
        }

        let available = 0;
        let quantumMs = Infinity;
        for (const s of candidates) {
          available += s.duration;
          if (s.duration < quantumMs) quantumMs = s.duration;
        }
        // Fallback quantum (should never happen unless price data is malformed).
        quantumMs = isFinite(quantumMs) ? quantumMs : 15 * 60e3;
        assert(quantumMs > 0);

        // Try to schedule as much as possible (up to timeNeeded). If constraints prevent it (e.g. missing price
        // data creates gaps, or maxPrice is too strict), back off in "slot" increments until feasible.
        const targetMaxMs = Math.max(0, Math.min(timeNeeded, available));
        if (targetMaxMs < 1) {
          log(LogLevel.Trace, `scheduleWindows(${scheduleTag}): nothing to schedule (need=${Math.round(timeNeeded / 60e3)}min avail=${Math.round(available / 60e3)}min)`);
          return scheduled;
        }

        log(
          LogLevel.Trace,
          `scheduleWindows(${scheduleTag}): need=${Math.round(timeNeeded / 60e3)}min targetMax=${Math.round(targetMaxMs / 60e3)}min before=${new Date(before_ts).toISOString()} ` +
          `candidates=${candidates.length} avail=${Math.round(available / 60e3)}min quantum=${Math.round(quantumMs / 60e3)}min ` +
          `maxPrice=${maxPrice === undefined ? "none" : fmtDbPrice(maxPrice)} capFactor=${SOFT_MAXPRICE_CAP_FACTOR} overPenalty=${OVERPRICE_PENALTY_FACTOR}`
        );

        let backoffSteps = 0;
        for (let targetMs = targetMaxMs; targetMs >= quantumMs; targetMs -= quantumMs) {
          const maxWindows = Math.max(1, Math.floor(targetMs / MIN_CHARGE_WINDOW_MS));

          let bestScore = Infinity;
          let bestWindows: { start: number; stop: number }[] = [];

          // Try 1 segment, then 2, then 3... Stop when adding another segment doesn't improve enough.
          for (let k = 1; k <= maxWindows; k++) {
            const long = targetMs - (k - 1) * MIN_CHARGE_WINDOW_MS;
            assert(long > 0);
            let remaining = candidates.slice();
            const windows: ChargeWindow[] = [];
            let score = 0;
            let ok = true;

            // Greedy placement: schedule the (possibly longer) remainder segment first, then the 60min chunks.
            // When k>1, long is guaranteed >= MIN_CHARGE_WINDOW_MS by construction of maxWindows.
            for (let i = 0; i < k; i++) {
              const d = i === 0 ? long : MIN_CHARGE_WINDOW_MS;
              if (k > 1) assert(d >= MIN_CHARGE_WINDOW_MS);

              let w: ChargeWindow | null = null;
              if (d > 0) {
                let total = 0;
                for (const s of remaining) total += s.duration;
                if (total + 1 >= d) {
                  // Sliding window over segment boundaries. Window always starts on a segment boundary.
                  let best: ChargeWindow | null = null;
                  let bestWindowScore = Infinity;
                  let left = 0;
                  let right = 0;
                  let curDur = 0;
                  let curScore = 0; // penalized "price*ms" proxy cost

                  while (left < remaining.length) {
                    while (right < remaining.length && curDur < d) {
                      // Don't allow a "window" to jump over gaps created by maxPrice filtering or missing data.
                      if (right > left && remaining[right].from !== remaining[right - 1].to) {
                        left = right;
                        curDur = 0;
                        curScore = 0;
                        continue;
                      }
                      const seg = remaining[right];
                      curDur += seg.duration;
                      curScore += seg.score;
                      right++;
                    }

                    if (curDur >= d) {
                      const first = remaining[left];
                      const last = remaining[right - 1];
                      const overhang = curDur - d;
                      // If the last slot is cheaper than the first, shift the window forward by the full overhang
                      // to replace expensive minutes at the start with cheaper minutes at the end.
                      const windowScore =
                        curScore -
                        overhang * (first.price > last.price ? priceToScorePerMs(first.price, maxPrice) : priceToScorePerMs(last.price, maxPrice));
                      const start = first.from + (first.price > last.price ? overhang : 0);
                      const stop = start + d;

                      if (maxPrice !== undefined) {
                        // avg is in "penalized price per ms" units; compare directly to raw maxPrice.
                        const avg = windowScore / d;
                        if (avg <= maxPrice && windowScore < bestWindowScore) {
                          bestWindowScore = windowScore;
                          best = { start, stop, score: windowScore };
                        }
                      } else if (windowScore < bestWindowScore) {
                        bestWindowScore = windowScore;
                        best = { start, stop, score: windowScore };
                      }
                    } else {
                      break;
                    }

                    const segL = remaining[left];
                    curDur -= segL.duration;
                    curScore -= segL.score;
                    left++;
                    if (right < left) {
                      right = left;
                      curDur = 0;
                      curScore = 0;
                    }
                  }

                  w = best;
                }
              }

              if (!w) {
                log(
                  LogLevel.Trace,
                  `scheduleWindows(${scheduleTag}): target=${Math.round(targetMs / 60e3)}min k=${k} failed at part=${i + 1}/${k} dur=${Math.round(d / 60e3)}min (no continuous window)`
                );
                ok = false;
                break;
              }

              windows.push(w);
              score += w.score;
              // Remove the chosen window from remaining candidates so future windows can't reuse the same time
              remaining = remaining.flatMap((s) => {
                // Outside the chosen window, keep as is.
                if (s.to <= w.start || s.from >= w.stop) return [s];
                // Keep the non-overlapping remainder of this segment.
                const remainders: Array<{ from: number; to: number; duration: number; price: number; score: number }> = [];
                if (s.from < w.start) {
                  const to = Math.min(s.to, w.start);
                  if (to > s.from) {
                    const duration = to - s.from;
                    remainders.push({ from: s.from, to, duration, price: s.price, score: priceToScorePerMs(s.price, maxPrice) * duration });
                  }
                }

                if (s.to > w.stop) {
                  const from = Math.max(s.from, w.stop);
                  if (s.to > from) {
                    const duration = s.to - from;
                    remainders.push({ from, to: s.to, duration, price: s.price, score: priceToScorePerMs(s.price, maxPrice) * duration });
                  }
                }

                return remainders;
              });
            }

            if (!ok) break;

            // First feasible solution is the baseline. Only accept a higher split-count if it's "10% cheaper per added segment".
            if (bestWindows.length === 0) {
              bestScore = score;
              bestWindows = windows.map((w) => ({ start: w.start, stop: w.stop }));
              log(LogLevel.Trace,
                `scheduleWindows(${scheduleTag}): target=${Math.round(targetMs / 60e3)}min k=${k} baseline avgPrice=${fmtDbPrice(bestScore / targetMs)} ` +
                `windows=${bestWindows.map((w) => `${new Date(w.start).toISOString()}..${new Date(w.stop).toISOString()}`).join(", ")}`
              );
              continue;
            }

            if (score <= bestScore * (1 - SPLIT_SAVE_FRACTION)) {
              bestScore = score;
              bestWindows = windows.map((w) => ({ start: w.start, stop: w.stop }));
              log(LogLevel.Trace,
                `scheduleWindows(${scheduleTag}): target=${Math.round(targetMs / 60e3)}min k=${k} accepted avgPrice=${fmtDbPrice(bestScore / targetMs)} ` +
                `windows=${bestWindows.map((w) => `${new Date(w.start).toISOString()}..${new Date(w.stop).toISOString()}`).join(", ")}`
              );
              continue;
            }

            // Not cheap enough to justify another split.
            log(LogLevel.Trace,
              `scheduleWindows(${scheduleTag}): target=${Math.round(targetMs / 60e3)}min k=${k} rejected avgPrice=${fmtDbPrice(score / targetMs)} >= ${fmtDbPrice((bestScore * (1 - SPLIT_SAVE_FRACTION)) / targetMs)} ` +
              `(need ${(SPLIT_SAVE_FRACTION * 100).toFixed(0)}% improvement)`
            );
            break;
          }

          if (bestWindows.length > 0) {
            bestWindows.sort((a, b) => a.start - b.start);
            if (backoffSteps > 0) {
              log(
                LogLevel.Trace,
                `scheduleWindows(${scheduleTag}): backed off ${backoffSteps} steps => scheduled=${Math.round(targetMs / 60e3)}min (from ${Math.round(targetMaxMs / 60e3)}min)`
              );
            }
            scheduled.windows = bestWindows;
            scheduled.scheduledMs = targetMs;
            return scheduled;
          }

          backoffSteps++;
        }

        log(LogLevel.Trace, `scheduleWindows(${scheduleTag}): no feasible schedule found (maxPrice gaps too large?)`);
        return scheduled;
      };

      const HandleTripCharge = () => {
        if (trip) {
          assert(trip.level);
          assert(trip.schedule_ts);
          addSoftIntent(ChargeType.Trip, `upcoming trip`, trip.level, trip.schedule_ts.getTime());
        }
      };

      if (startLevel < minimum_charge) {
        // Emergency charge up to minimum level
        const timeNeeded = ChargeDuration(startLevel, minimum_charge);
        assert(timeNeeded > 0);
        const stop = hardStart + timeNeeded;
        chargePlan.push({
          chargeStart: new Date(hardStart),
          chargeStop: new Date(stop),
          chargeType: ChargeType.Minimum,
          level: minimum_charge,
          comment: `emergency charge`,
        });
        hardStart = stop;
        startLevel = minimum_charge;
        smartStatus = (vehicle.connected ? `Direct charging to ` : `Connect charger to charge to `) + `${minimum_charge}%`;
      }

      // Manual schedule overrides auto choices
      if (manual) {
        if (!manual.schedule_ts) {
          assert(manual.level);
          log(LogLevel.Debug, `Manual charging directly to ${manual.level}%`);
          chargePlan.push({
            chargeStart: null,
            chargeStop: null,
            chargeType: ChargeType.Manual,
            level: manual.level,
            comment: `manual charge`,
          });
          smartStatus = smartStatus || `Manual charging to ${manual.level}%`;
        } else {
          assert(manual.level);
          assert(manual.schedule_ts);
          addSoftIntent(ChargeType.Manual, `manual charge`, manual.level, manual.schedule_ts.getTime());
        }

        // Still do trip charging!
        HandleTripCharge();
      } else {
        let stats: DBLocationStats | null = null;
        if (location_uuid) {
          stats = await this.currentStats(vehicle, location_uuid);
          log(LogLevel.Trace, `stats: ${JSON.stringify(stats)}`);
        }

        if (stats && stats.weekly_avg7_price && stats.weekly_avg21_price && stats.threshold) {
          const averagePrice = stats.weekly_avg7_price + (stats.weekly_avg7_price - stats.weekly_avg21_price) / 2;
          fillMaxPrice = (averagePrice * stats.threshold) / 100;
        }

        const ai = {
          charge: false,
          learning: false,
          level: null,
          ts: null,
        } as {
          charge: boolean;
          learning: boolean;
          level: number | null;
          ts: number | null;
        };

        if (location_uuid) {
          if (startLevel < vehicle.maximum_charge) {
            // Generate an AI schedule
            const schedule = stats && (await this.generateAIschedule(vehicle, location_uuid));
            // If we have a trip and ai.ts and schedule.ts is more than 12 hours apart, we should still AI charge
            if (!trip || !trip.schedule_ts || trip.schedule_ts.getTime() > priceAvailable
              || (schedule && Math.abs(trip.schedule_ts.getTime() - schedule.ts) > 12 * 60 * 60e3)
            ) {
              ai.charge = true;

              if (schedule) {
                ai.level = schedule.level;
                ai.ts = schedule.ts;
              } else {
                // Disable smart charging because without threshold and averages it can not make a good decision
                log(LogLevel.Debug, `Missing stats for smart charging.`);
                ai.learning = true;
              }
            }
          }
        }

        this.updateAIschedule(vehicle.vehicle_uuid, ai.ts, ai.level);

        // Do we have an upcoming trip?
        HandleTripCharge();

        if (startLevel < vehicle.maximum_charge) {
          if (ai.charge) {
            if (ai.learning) {
              // Learning charge
              let start_ts = now;
              if (vehicle.connected_id) {
                const start = await this.db.pg.oneOrNone(`SELECT start_ts FROM connected WHERE connected_id = $1;`,[vehicle.connected_id]);
                if (start && start.start_ts) {
                  start_ts = start.start_ts.getTime();
                }
              }
              smartStatus = smartStatus || `Smart charging disabled (learning)`;
              addSoftIntent(ChargeType.Fill, `learning`, vehicle.maximum_charge, start_ts + 12 * 60 * 60e3);
              fillMaxPrice = null; // disable low-price filling
            } else {
              assert(ai.level);
              assert(ai.ts);
              const neededCharge = ai.level - vehicle.level;
              const before = new Date(ai.ts);
              smartStatus = smartStatus
                || `Predicting battery level ${ai.level}% (${neededCharge > 0 ? Math.round(neededCharge) + "%" : "no"} charge) is needed before ${before.toISOString()}`;
              log(LogLevel.Debug, `Current level: ${vehicle.level}, predicting ${ai.level}% (${minimum_charge}+${neededCharge - minimum_charge}) is needed before ${before.toISOString()}`);
              addSoftIntent(ChargeType.Routine, `routine charge`, ai.level, ai.ts);

              // locations settings charging
              {
                const goal = (locationSettings && locationSettings.goal) || SmartChargeGoal.Balanced;
                const goalLevel =
                  goal === SmartChargeGoal.Full ? vehicle.maximum_charge
                  : goal === SmartChargeGoal.Low ? 0
                  : Math.min(
                    vehicle.maximum_charge,
                    Math.max(ai.level, parseInt(goal) || Math.round(ai.level + (vehicle.maximum_charge - ai.level) / 2))
                  );

                if (goalLevel > ai.level) {
                  addSoftIntent(ChargeType.Prefered, `charge setting`, goalLevel, ai.ts);
                }
              }
            }
          }
        }
      }

      if (!manual || manual.schedule_ts) {
        scheduleSoftIntents();
      }
    }

    if (smartStatus) {
      this.setSmartStatus(vehicle, smartStatus);
    }

    if (chargePlan.length) {
      chargePlan = Logic.cleanupPlan(chargePlan);
      log(LogLevel.Trace, chargePlan);
    }
    await this.db.pg.one(
      `UPDATE vehicle SET charge_plan = $1:json, charge_plan_location_uuid = $2 WHERE vehicle_uuid = $3 RETURNING *;`,
      [chargePlan.length > 0 ? chargePlan : null, chargePlan.length > 0 ? location_uuid : null, vehicle.vehicle_uuid]
    );
  }

  public async refreshChargePlan(vehicleUUID?: string, accountUUID?: string) {
    if (vehicleUUID === undefined && accountUUID === undefined) {
      throw "refreshChargePlan called with invalid arguments";
    }

    const dblist = await this.db.getVehicles(accountUUID, vehicleUUID);
    for (const v of dblist) {
      await this.refreshVehicleChargePlan(v);
    }
  }

  public async priceListRefreshed(price_list_uuid: string) {
    const dblist = await this.db.pg.manyOrNone(
      `SELECT v.* FROM vehicle v JOIN location l ON (l.account_uuid = v.account_uuid) WHERE l.price_list_uuid = $1;`,
      [price_list_uuid]
    );
    for (const v of dblist) {
      await this.refreshVehicleChargePlan(v);
    }
  }
}
