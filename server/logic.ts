/**
 * @file Server Logic for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import { DBInterface } from "./db-interface";
import {
  DBVehicle,
  DBCharge,
  DBChargeCurrent,
  DBTrip,
  DBConnected,
  DBCurrentStats
} from "./db-schema";
import { LogLevel, log, arrayMean, prettyTime } from "@shared/utils";
import {
  UpdateVehicleDataInput,
  ChargePlan,
  ChargeType,
  ChargePlanToJS,
  ScheduleToJS
} from "./gql/vehicle-type";

const TRIP_TOPUP_MARGIN = 15 * 60e3; // 15 minutes before trip time

export class Logic {
  constructor(private db: DBInterface) {}
  public init() {}

  public async updateVehicleData(
    input: UpdateVehicleDataInput,
    now: Date = new Date()
  ) {
    // First lookup old record
    const vehicle: DBVehicle = await this.db.getVehicle(input.id);
    log(LogLevel.Trace, `vehicle: ${JSON.stringify(vehicle)}`);

    // Convert API values to database values
    const data = {
      latitude: input.geoLocation.latitude * 1e6, // 6 decimals precision to integer
      longitude: input.geoLocation.longitude * 1e6, // 6 decimals precision to integer
      level: input.batteryLevel, // in %
      odometer: input.odometer, // in meter
      outside_temp: input.outsideTemperature * 10, // celsius to deci-celsius (20.5 = 205)
      inside_temp: input.insideTemperature * 10, // celsius to deci-celsius (20.5 = 205)
      climate_control: input.climateControl, // boolean
      driving: input.isDriving, // boolean
      connected: input.connectedCharger, // ac|dc|null
      charging_to: input.chargingTo, // in %
      estimate: input.estimatedTimeLeft || 0, // estimated time in minutes to complete charge
      power: (input.powerUse || 0) * 1000, // current power drain kW to W
      added: (input.energyAdded || 0) * 1000 * 60 // added kWh to Wm (1000 * 60)
    };

    // Did we move?
    const lastLocationUUID: string | null = vehicle.location_uuid;
    let currentLocationUUID: string | null = vehicle.location_uuid;
    /*
      this optimization does not work when adding a new location
    if (vehicle.location_micro_latitude !== data.latitude ||
      vehicle.location_micro_longitude !== data.longitude
    )*/ {
      const location = await this.db.lookupKnownLocation(
        vehicle.account_uuid,
        data.latitude,
        data.longitude
      );
      if (location) {
        currentLocationUUID = location.id;
      } else {
        currentLocationUUID = null;
      }
    }

    // Update new values
    {
      await this.db.pg.one(
        `UPDATE vehicle SET ($1:name) = ($1:csv) WHERE vehicle_uuid=$2 RETURNING *;`,
        [
          {
            location_uuid: currentLocationUUID,
            location_micro_latitude: data.latitude,
            location_micro_longitude: data.longitude,
            level: data.level,
            odometer: data.odometer,
            outside_deci_temperature: data.outside_temp,
            inside_deci_temperature: data.inside_temp,
            climate_control: data.climate_control,
            driving: data.driving,
            connected: data.connected !== null,
            charging_to: data.charging_to,
            estimate: data.estimate,
            updated: now
          },
          input.id
        ]
      );
    }

    let doPricePlan = false;

    if (data.connected || vehicle.connected_id) {
      // Are we connected?
      let connection: DBConnected;
      if (vehicle.connected_id === null) {
        // New connection, create a record
        doPricePlan = true;
        connection = await this.db.pg.one(
          `INSERT INTO connected($[this:name]) VALUES($[this:csv]) RETURNING *;`,
          {
            vehicle_uuid: input.id,
            type: data.connected,
            location_uuid: currentLocationUUID,
            start_ts: now,
            start_level: data.level,
            start_odometer: data.odometer,
            end_ts: now,
            end_level: data.level,
            energy_used: 0,
            cost: 0,
            saved: 0
          }
        );
        vehicle.connected_id = connection.connected_id;
        log(
          LogLevel.Debug,
          `Vehicle connected (connected_id=${connection.connected_id})`
        );
        await this.db.pg.none(
          `UPDATE vehicle SET connected_id = $1 WHERE vehicle_uuid = $2`,
          [vehicle.connected_id, vehicle.vehicle_uuid]
        );
      } else {
        // or read charge record
        connection = await this.db.pg.one(
          `SELECT * FROM connected WHERE connected_id = $1`,
          [vehicle.connected_id]
        );
      }

      if (data.charging_to || vehicle.charge_id) {
        // Are we charging?
        let charge: DBCharge;
        if (vehicle.charge_id === null) {
          // New charge, create a charge record
          charge = await this.db.pg.one(
            `INSERT INTO charge($[this:name]) VALUES($[this:csv]) RETURNING *;`,
            {
              vehicle_uuid: input.id,
              connected_id: vehicle.connected_id,
              type: data.connected,
              location_uuid: currentLocationUUID,
              start_ts: now,
              start_level: data.level,
              start_added: data.added,
              target_level: data.charging_to,
              estimate: data.estimate,
              end_ts: now,
              end_level: data.level,
              end_added: data.added,
              energy_used: 0
            }
          );
          vehicle.charge_id = charge.charge_id;
          log(LogLevel.Debug, `Started charge ${charge.charge_id}`);
          await this.db.pg.none(
            `UPDATE vehicle SET charge_id = $1 WHERE vehicle_uuid = $2`,
            [vehicle.charge_id, vehicle.vehicle_uuid]
          );
        } else {
          // or read charge record
          charge = await this.db.pg.one(
            `SELECT * FROM charge WHERE charge_id = $1`,
            [vehicle.charge_id]
          );

          // Update charge record
          const deltaTime = (now.getTime() - charge.end_ts.getTime()) / 1e3; // ms / 1000 = s
          const deltaUsed = Math.round(
            Math.max(0, data.power * deltaTime) / 60
          ); // used = power (W) * time (s) = Ws / 60 = Wm
          connection.energy_used += deltaUsed;

          // TODO add cost calculations
          {
            const priceLookup: {
              price_now: number;
              price_then: number;
            } = await this.db.pg.one(
              `WITH wouldve AS (
                  SELECT MIN(b.start_ts) as ts, SUM(a.end_ts - a.start_ts) as duration
                  FROM charge a JOIN connected b ON (a.connected_id = b.connected_id) WHERE b.connected_id = $1
              ), prices AS (
                  SELECT ts, price FROM price_list p JOIN location l ON (l.price_code = p.price_code) WHERE location_uuid = $2
              )
              SELECT 
                  (SELECT price FROM prices WHERE ts < $3 ORDER BY ts DESC LIMIT 1) price_now,
                  (SELECT price FROM prices a, wouldve b WHERE a.ts < b.ts+duration ORDER BY a.ts DESC LIMIT 1) price_then;`,
              [vehicle.connected_id, vehicle.location_uuid, new Date(now)]
            );

            if (priceLookup.price_now !== null) {
              connection.cost += Math.round(
                (priceLookup.price_now * deltaUsed) / 60e3
              ); // price in (kWh) * used in (Wm)   Wm / 60e3 => kWh
              if (priceLookup.price_then !== null) {
                connection.saved += Math.round(
                  ((priceLookup.price_then - priceLookup.price_now) *
                    deltaUsed) /
                    60e3
                );
              }
            }
          }

          {
            const update: any = {
              end_ts: now,
              end_level: data.level
            };
            if (data.charging_to) {
              update.target_level = data.charging_to;
              update.estimate = data.estimate;
            }
            if (data.connected) {
              update.energy_used = charge.energy_used + deltaUsed;
              update.end_added = data.added;
            }
            log(
              LogLevel.Debug,
              `Updating charge ${
                vehicle.charge_id
              } with ${deltaUsed} Wm used in ${deltaTime}s`
            );
            charge = await this.db.pg.one(
              `UPDATE charge SET ($1:name) = ($1:csv) WHERE charge_id=$2 RETURNING *;`,
              [update, vehicle.charge_id]
            );
            log(LogLevel.Trace, `charge: ${JSON.stringify(charge)}`);
          }

          // charge_curve logic
          if (data.level > charge.start_level) {
            // Ignore first % since integer % lacks precision
            const current: DBChargeCurrent | null = await this.db.pg.oneOrNone(
              `SELECT * FROM charge_current WHERE charge_id = $1;`,
              [vehicle.charge_id]
            );
            if (!current || data.level > current.start_level) {
              // reached a new level, create charge curve statistics
              doPricePlan = true;
              if (current && data.level === current.start_level + 1) {
                // only 1% changes, or we've been offline and it's unreliable
                const duration =
                  (now.getTime() - current.start_ts.getTime()) / 1000; // ms / 1000 = s
                const avgPower = arrayMean(current.powers); // Watt
                const energyUsed = (avgPower * duration) / 60; // power (W) * time (s) = Ws / 60 = Wm
                const energyAdded = data.added - current.start_added; // Wm
                const avgTemp = arrayMean(current.outside_deci_temperatures); // deci-celsius
                log(
                  LogLevel.Debug,
                  `Calculated charge curve between ${
                    current.start_level
                  }% and ${data.level}% is ${(energyUsed / 60.0).toFixed(
                    2
                  )}kWh in ${(duration / 60.0).toFixed(2)}m`
                );
                await this.db.setChargeCurve(
                  input.id,
                  vehicle.charge_id,
                  current.start_level,
                  duration,
                  avgTemp,
                  energyUsed,
                  energyAdded
                );
              }
              await this.db.pg.none(
                `INSERT INTO charge_current(charge_id) SELECT $[charge_id] WHERE NOT EXISTS (SELECT charge_id FROM charge_current WHERE charge_id = $[charge_id]);` +
                  `UPDATE charge_current SET start_ts=$[start_ts], start_level=$[start_level], start_added=$[start_added], powers='{}', outside_deci_temperatures='{}' WHERE charge_id = $[charge_id];`,
                {
                  charge_id: vehicle.charge_id,
                  start_ts: now,
                  start_level: data.level,
                  start_added: data.added
                }
              );
            }
            const new_current = await this.db.pg.one(
              `UPDATE charge_current SET powers = array_append(powers, $[power]), outside_deci_temperatures = array_append(outside_deci_temperatures, cast($[outside_temp] as smallint)) WHERE charge_id=$[charge_id] RETURNING *;`,
              {
                charge_id: vehicle.charge_id,
                power: Math.trunc(data.power),
                outside_temp: Math.trunc(data.outside_temp)
              }
            );
            log(LogLevel.Trace, `current: ${JSON.stringify(new_current)}`);
          }
        }

        if (!data.charging_to) {
          // We stopped charging
          log(LogLevel.Debug, `Ending charge ${vehicle.charge_id}`);
          await this.db.pg.none(
            `DELETE FROM charge_current WHERE charge_id=$1; UPDATE vehicle SET charge_id = null WHERE vehicle_uuid = $2`,
            [vehicle.charge_id, vehicle.vehicle_uuid]
          );
        }
      }

      // Update connection record
      connection.end_ts = now;
      connection.end_level = data.level;
      await this.db.pg.one(
        `UPDATE connected SET ($1:name) = ($1:csv) WHERE connected_id=$2 RETURNING *;`,
        [
          {
            end_ts: now,
            end_level: data.level,
            energy_used: connection.energy_used,
            cost: connection.cost,
            saved: connection.saved
          },
          vehicle.connected_id
        ]
      );

      if (!data.connected) {
        // We disconnected
        log(
          LogLevel.Debug,
          `Vehicle no longer connected (connected_id=${vehicle.connected_id})`
        );
        await this.db.pg.none(
          `UPDATE vehicle SET connected_id = null, charge_plan = null WHERE vehicle_uuid = $1;`,
          [vehicle.vehicle_uuid]
        );
      }
    }

    if (
      lastLocationUUID !== currentLocationUUID ||
      data.driving ||
      vehicle.trip_id !== null
    ) {
      // moved, driving or on a trip
      let trip: DBTrip;
      if (vehicle.trip_id === null) {
        trip = await this.db.pg.one(
          `INSERT INTO trip($[this:name]) VALUES($[this:csv]) RETURNING *;`,
          {
            vehicle_uuid: input.id,
            start_ts: now,
            start_level: data.level,
            start_location_uuid: lastLocationUUID,
            start_odometer: data.odometer,
            start_outside_deci_temperature: data.outside_temp,
            end_ts: now,
            end_level: data.level,
            end_location_uuid: currentLocationUUID,
            distance: 0
          }
        );
        vehicle.trip_id = trip.trip_id;
        log(LogLevel.Debug, `Started trip ${trip.trip_id}`);
        await this.db.pg.none(
          `UPDATE vehicle SET trip_id = $1 WHERE vehicle_uuid = $2`,
          [vehicle.trip_id, vehicle.vehicle_uuid]
        );
      } else {
        trip = await this.db.pg.one(`SELECT * FROM trip WHERE trip_id = $1`, [
          vehicle.trip_id
        ]);
      }

      // Update trip record
      const distance = data.odometer - trip.start_odometer;
      const traveled = Math.round(distance - trip.distance);
      if (traveled > 0) {
        log(
          LogLevel.Debug,
          `Updating trip ${vehicle.trip_id} with ${traveled}m driven`
        );
        // TODO lookup location id
        trip = await this.db.pg.one(
          `UPDATE trip SET end_ts=$[ts], end_level=$[level], end_location_uuid=$[location_uuid], distance=$[distance] WHERE trip_id=$[trip_id] RETURNING *;`,
          {
            trip_id: vehicle.trip_id,
            ts: now,
            level: data.level,
            location_uuid: currentLocationUUID,
            distance: distance
          }
        );
      }

      if (!data.driving) {
        let stopTrip = false;
        if (currentLocationUUID !== null) {
          // We stopped driving at a location we know
          log(
            LogLevel.Debug,
            `Vehicle at location ${currentLocationUUID} after driving ${trip.distance /
              1e3} km, ending trip ${trip.trip_id}`
          );
          stopTrip = true;
          if (trip.distance < 1e3) {
            // totally ignore trips less than 1 km
            log(
              LogLevel.Debug,
              `Removing trip ${trip.trip_id}, because it only recorded ${
                trip.distance
              } meters`
            );
            await this.db.pg.none(`DELETE FROM trip WHERE trip_id=$1`, [
              vehicle.trip_id
            ]);
          }
        } else if (data.connected) {
          log(
            LogLevel.Debug,
            `Vehicle connected after driving ${trip.distance /
              1e3} km, ending trip ${trip.trip_id}`
          );
          stopTrip = true;
        }
        if (stopTrip) {
          await this.db.pg.none(
            `UPDATE vehicle SET trip_id = null WHERE trip_id = $1`,
            [vehicle.trip_id]
          );
          doPricePlan = true;
        }
      }
      log(LogLevel.Trace, `trip: ${JSON.stringify(trip)}`);
    }

    // Update eventMap
    {
      const deltaTime = Math.min(
        (now.getTime() - vehicle.updated.getTime()) / 1e3
      );
      if (deltaTime > 0 && deltaTime < 3 * 60 * 60) {
        // Limit for data sanity during polling loss
        const deltaEvent = {
          vehicle_uuid: input.id,
          hour: new Date(
            new Date(now.getTime()).setHours(now.getHours(), 0, 0, 0)
          ),
          minimum_level: data.level,
          maximum_level: data.level,
          driven_seconds: data.driving ? deltaTime : 0,
          driven_meters: data.odometer - vehicle.odometer,
          charged_seconds: data.charging_to ? deltaTime : 0,
          charge_energy: data.charging_to
            ? Math.round(Math.max(0, data.power * deltaTime) / 60)
            : 0 // used = power (W) * time (s) = Ws / 60 = Wm
        };
        await this.db.pg.one(
          `INSERT INTO event_map($[this:name]) VALUES ($[this:csv])
                    ON CONFLICT(vehicle_uuid, hour) DO UPDATE SET
                        minimum_level=LEAST(event_map.minimum_level, EXCLUDED.minimum_level),
                        maximum_level=GREATEST(event_map.maximum_level, EXCLUDED.maximum_level),
                        driven_seconds=event_map.driven_seconds + EXCLUDED.driven_seconds,
                        driven_meters=event_map.driven_meters + EXCLUDED.driven_meters,
                        charged_seconds=event_map.charged_seconds + EXCLUDED.charged_seconds,
                        charge_energy=event_map.charge_energy + EXCLUDED.charge_energy
                    RETURNING *;`,
          deltaEvent
        );
      }
    }

    // Update charge plan if needed
    if (doPricePlan) {
      await this.refreshChargePlan(input.id);
    }
  }

  public async currentStats(
    vehicle_uuid: string,
    location_uuid: string
  ): Promise<DBCurrentStats> {
    const stats: DBCurrentStats | null = await this.db.pg.oneOrNone(
      `SELECT * FROM current_stats WHERE vehicle_uuid=$1 AND location_uuid=$2 AND date=current_date`,
      [vehicle_uuid, location_uuid]
    );
    if (stats !== null) {
      return stats;
    } else {
      const level_charge_time = (await this.db.pg.oneOrNone(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) as seconds
                FROM charge a JOIN charge_curve b ON (a.charge_id = b.charge_id)
                WHERE a.vehicle_uuid = $1 AND location_uuid = $2`,
        [vehicle_uuid, location_uuid]
      )).seconds;

      // What is the current weekly average power price
      const avg_prices: { avg7: number; avg21: number } = await this.db.pg.one(
        `WITH my_price_list AS (
                    SELECT p.* FROM price_list p JOIN location l ON (l.price_code = p.price_code) WHERE location_uuid = $1
                )
                SELECT 
                    (SELECT AVG(price::float) FROM my_price_list WHERE ts >= current_date - interval '7 days') as avg7,
                    (SELECT AVG(price::float) FROM my_price_list WHERE ts >= current_date - interval '21 days') as avg21;`,
        [location_uuid]
      );

      let threshold = 0.9;

      interface HistoryEntry {
        connected_id: number;
        start_level: number;
        end_level: number;
        needed: number;
        fraction: number;
        price: number;
        threshold: number;
      }

      const history: HistoryEntry[] = await this.db.pg.manyOrNone(
        `WITH my_price_list AS (
          SELECT p.* FROM price_list p JOIN location l ON (l.price_code = p.price_code) WHERE location_uuid = $2
        ), my_connected AS (
          SELECT * FROM connected WHERE vehicle_uuid = $1 AND end_ts >= current_date - interval '2 weeks' AND end_ts < current_date AND start_ts::date >= (SELECT MIN(ts)::date FROM my_price_list)
        ), connections AS (
          SELECT *, (SELECT a.end_level-b.start_level FROM connected b WHERE b.connected_id > a.connected_id ORDER BY connected_id LIMIT 1) as needed
          FROM my_connected a WHERE location_uuid = $2 AND connected_id < (SELECT MAX(connected_id) FROM my_connected)
        ), period AS (
          SELECT generate_series(date_trunc('hour', (SELECT MIN(start_ts) FROM connections)), current_date - interval '1 hour', '1 hour') as hour
        ), week_avg AS (
          SELECT day, (SELECT AVG(price::float) FROM my_price_list WHERE ts >= day - interval '7 days' AND ts < day) as avg7,
          (SELECT AVG(price::float) FROM my_price_list WHERE ts >= day - interval '21 days' AND ts < day) as avg21 FROM
          (SELECT date_trunc('day', hour) as day FROM period GROUP BY 1) as a
        ), connection_map AS (
          SELECT connected_id,start_level,end_level,needed,hour,LEAST(1.0,
            EXTRACT(epoch FROM hour+interval '1 hour'-start_ts)/3600,
            EXTRACT(epoch FROM end_ts-hour)/3600
          ) as fraction, price,price/(avg7+(avg7-avg21)/2) as threshold
          FROM period
          JOIN connections ON (hour >= date_trunc('hour',start_ts) AND hour <= date_trunc('hour',end_ts))
          JOIN my_price_list ON (ts = hour)
          JOIN week_avg ON (day = date_trunc('day', hour))
        )
        SELECT * FROM connection_map ORDER BY connected_id,hour;`,
        [vehicle_uuid, location_uuid]
      );

      if (history.length > 0) {
        // Charge simulation
        const charge_levels: {
          minimum_charge: number;
          maximum_charge: number;
        } = await this.db.pg.one(
          `SELECT minimum_charge, maximum_charge FROM vehicle WHERE vehicle_uuid = $1`,
          [vehicle_uuid]
        );

        const thresholdList = history.map(h => h.threshold).sort();
        let bestCost = Number.POSITIVE_INFINITY;
        for (const t of thresholdList) {
          let current: HistoryEntry | undefined;
          let totalCharged = 0;
          let totalCost = 0;
          let lvl = 0;
          let neededLevel = 0;
          for (const h of history) {
            if (!current || current.connected_id !== h.connected_id) {
              if (current && current.connected_id + 1 === h.connected_id) {
                lvl -= Math.max(0, current.end_level - h.start_level); // charge used between connections
                if (
                  lvl < h.start_level &&
                  lvl < charge_levels.minimum_charge / 2
                ) {
                  // half of minimum charge is where I draw the line
                  lvl = -1;
                  break;
                }
              } else {
                // We charged somewhere else on the way, so reset simulated battery lvl
                lvl = h.start_level;
              }
              current = h;
              neededLevel = Math.min(
                charge_levels.maximum_charge,
                Math.max(
                  charge_levels.minimum_charge,
                  charge_levels.minimum_charge + current.needed * 1.1
                )
              );
            }

            let charge =
              h.threshold <= t
                ? charge_levels.maximum_charge - lvl
                : lvl < neededLevel
                ? neededLevel - lvl
                : 0;
            if (charge > 0) {
              const chargeTime = Math.min(
                3600 * h.fraction,
                charge * level_charge_time
              );
              const newLevel = Math.min(
                charge_levels.maximum_charge,
                lvl + chargeTime / level_charge_time
              );
              totalCharged += newLevel - lvl;
              totalCost += (chargeTime / 3600) * h.price;
              lvl = newLevel;
            }
          }
          const f = totalCost / (totalCharged * totalCharged);
          if (lvl > charge_levels.minimum_charge && f < bestCost) {
            bestCost = f;
            threshold = t;
          }
        }
      }

      return await this.db.pg.one(
        `INSERT INTO current_stats($[this:name]) VALUES ($[this:csv]) RETURNING *;`,
        {
          vehicle_uuid: vehicle_uuid,
          location_uuid: location_uuid,
          level_charge_time: Math.round(level_charge_time),
          weekly_avg7_price: Math.round(avg_prices.avg7),
          weekly_avg21_price: Math.round(avg_prices.avg21),
          threshold: Math.round(threshold * 100)
        }
      );
    }
  }

  private async chargeDuration(
    vehicleUUID: string,
    locationUUID: string,
    from: number,
    to: number
  ) {
    // TODO: do we need to consider temperature?
    const chargeCurve: {
      level: number;
      seconds: number;
    }[] = await this.db.pg.manyOrNone(
      `SELECT level, percentile_cont(0.5) WITHIN GROUP(ORDER BY duration) AS seconds
            FROM charge a JOIN charge_curve b ON(a.charge_id = b.charge_id)
            WHERE a.vehicle_uuid = $1 AND a.location_uuid = $2 GROUP BY level ORDER BY level;`,
      [vehicleUUID, locationUUID]
    );
    let current;
    if (chargeCurve.length > 0) {
      current = chargeCurve.shift()!.seconds;
    } else {
      current =
        (await this.db.pg.one(
          `SELECT AVG(duration) FROM charge a JOIN charge_curve b ON (a.charge_id = b.charge_id) WHERE a.vehicle_uuid = $1 AND location_uuid = $2;`,
          [vehicleUUID, locationUUID]
        )).avg ||
        (await this.db.pg.one(
          `SELECT AVG(60.0 * estimate / (target_level-end_level)) FROM charge WHERE end_level < target_level AND vehicle_uuid = $1 AND location_uuid = $2;`,
          [vehicleUUID, locationUUID]
        )).avg ||
        20 * 60; // 20 min default for first time charge
    }
    assert(current !== undefined && current !== null);

    let sum = 0;
    if (to > from) {
      for (let level = from; level <= to; ++level) {
        while (chargeCurve.length > 0 && level >= chargeCurve[0].level) {
          current = chargeCurve.shift()!.seconds;
        }
        sum += level < to ? current : current * 0.75; // remove 25% of the last % to not overshoot
      }
    }

    return sum * 1e3;
  }

  private static cleanupPlan(plan: ChargePlan[]): ChargePlan[] {
    function nstart(n: Date | null) {
      return (n && n.getTime()) || -Infinity;
    }
    function nstop(n: Date | null) {
      return (n && n.getTime()) || Infinity;
    }
    const chargePrio = {
      [ChargeType.calibrate]: 0,
      [ChargeType.minimum]: 1,
      [ChargeType.trip]: 2,
      [ChargeType.routine]: 3,
      [ChargeType.prefered]: 4,
      [ChargeType.fill]: 5
    };
    plan.sort(
      (a, b) =>
        nstart(a.chargeStart) - nstart(b.chargeStart) ||
        nstop(a.chargeStop) - nstop(b.chargeStop) ||
        chargePrio[a.chargeType] - chargePrio[b.chargeType]
    );

    for (let i = 0; i < plan.length - 1; ++i) {
      const a = plan[i];
      const b = plan[i + 1];
      if (nstart(b.chargeStart) <= nstop(a.chargeStop)) {
        if (
          a.chargeType === b.chargeType ||
          nstop(b.chargeStop) <= nstop(a.chargeStop)
        ) {
          // Merge them
          if (nstop(b.chargeStop) > nstop(a.chargeStop)) {
            a.chargeStop = b.chargeStop;
            a.level = Math.max(a.level, b.level);
          }
          plan.splice(i + 1, 1);
          --i;
        } else {
          // Adjust them
          b.chargeStart = a.chargeStop;
        }
      }
    }
    return plan;
  }

  private async setSmartStatus(vehicle: DBVehicle, status: string) {
    if (vehicle.smart_status !== status) {
      await this.db.pg.none(
        `UPDATE vehicle SET smart_status=$1 WHERE vehicle_uuid=$2`,
        [status, vehicle.vehicle_uuid]
      );
    }
  }

  private async generateChargePlan(
    vehicle: DBVehicle,
    batteryLevel: number,
    before: number,
    chargeType: ChargeType,
    comment: string
  ): Promise<ChargePlan[]> {
    assert(vehicle.location_uuid !== undefined);
    const now = Date.now();

    let plan: ChargePlan[] = [];

    const timeNeeded = await this.chargeDuration(
      vehicle.vehicle_uuid,
      vehicle.location_uuid,
      vehicle.level,
      batteryLevel
    );

    if (timeNeeded > 0) {
      // Get our future price map
      const priceMap: {
        ts: Date;
        price: number;
        in_range: boolean;
      }[] = await this.db.pg.manyOrNone(
        `SELECT ts, price FROM price_list p JOIN location l ON (l.price_code = p.price_code) WHERE location_uuid = $1 AND ts >= NOW() - interval '1 hour' AND ts < $2 ORDER BY price`,
        [vehicle.location_uuid, new Date(before)]
      );

      if (priceMap.length > 0) {
        let timeLeft = timeNeeded;
        for (const price of priceMap) {
          if (timeLeft <= 0) break;
          const ts = price.ts.getTime();
          const start = ts < now ? now : ts;
          const fullHour = ts + 60 * 60 * 1e3;
          let end = Math.min(start + timeLeft, before, fullHour);
          let chargeStart = ts < start ? new Date(ts) : new Date(start);
          plan.push({
            chargeStart: chargeStart,
            chargeStop: new Date(end),
            level: batteryLevel,
            chargeType: chargeType,
            comment: comment
          });
          timeLeft -= end - start;
        }
        log(LogLevel.Trace, priceMap);
      } else {
        // no prices? then just charge
        log(LogLevel.Debug, `No price data exists, will just wing it!`);
        plan.push({
          chargeStart: null,
          chargeStop: new Date(now + timeNeeded),
          level: batteryLevel,
          chargeType: ChargeType.routine,
          comment: `no price data`
        });
      }
    }
    return plan;
  }

  private async lowPriceFill(
    vehicle: DBVehicle,
    stats: DBCurrentStats
  ): Promise<ChargePlan[]> {
    const averagePrice =
      stats.weekly_avg7_price +
      (stats.weekly_avg7_price - stats.weekly_avg21_price) / 2;
    const now = Date.now();

    const thresholdPrice = (averagePrice * stats.threshold) / 100;

    let plan: ChargePlan[] = [];

    // Get our future price map
    const priceMap: {
      ts: Date;
      price: number;
    }[] = await this.db.pg.manyOrNone(
      `SELECT ts, price FROM price_list p JOIN location l ON (l.price_code = p.price_code) WHERE location_uuid = $1 AND ts >= NOW() - interval '1 hour' AND price <= $2 ORDER BY ts`,
      [vehicle.location_uuid, thresholdPrice]
    );

    if (priceMap.length > 0) {
      for (const price of priceMap) {
        const ts = price.ts.getTime();
        const start = ts < now ? now : ts;
        // Fill'er up
        plan.push({
          chargeStart: ts < start ? new Date(ts) : new Date(start),
          chargeStop: new Date(ts + 60 * 60 * 1e3),
          level: vehicle.maximum_charge,
          chargeType: ChargeType.fill,
          comment: `low price`
        });
      }
      log(LogLevel.Trace, priceMap);
    }
    return plan;
  }

  private async refreshVehicleChargePlan(vehicle: DBVehicle) {
    log(LogLevel.Trace, `vehicle: ${JSON.stringify(vehicle)}`);
    if (vehicle.location_uuid === null) {
      log(LogLevel.Trace, `Vehicle at unknown location`);
      return this.setSmartStatus(vehicle, ``);
    }

    const now = Date.now();

    let plan: ChargePlan[] = vehicle.charge_plan
      ? (vehicle.charge_plan as ChargePlan[])
          .filter(f => {
            return (
              f.chargeStart === null &&
              vehicle.level < vehicle.minimum_charge + 1
            );
          })
          .map(f => ChargePlanToJS(f))
      : [];

    // Check charge calibration
    const maxLevel = (await this.db.pg.one(
      `SELECT MAX(level) as max_level FROM charge a JOIN charge_curve b ON(a.charge_id = b.charge_id)
          WHERE a.vehicle_uuid = $1 AND a.location_uuid = $2;`,
      [vehicle.vehicle_uuid, vehicle.location_uuid]
    )).max_level;
    if (vehicle.level < vehicle.maximum_charge && (maxLevel || 0) < 100) {
      plan = [
        {
          chargeStart: null,
          chargeStop: null,
          level: 100,
          chargeType: ChargeType.calibrate,
          comment: "Charge calibration"
        }
      ];
      this.setSmartStatus(
        vehicle,
        `Charge calibration needed at current location`
      );
    } else {
      const stats = await this.currentStats(
        vehicle.vehicle_uuid,
        vehicle.location_uuid
      );
      log(LogLevel.Trace, `stats: ${JSON.stringify(stats)}`);

      if (vehicle.level < vehicle.minimum_charge) {
        // Emergency charge up to minimum level
        // new emergency plan needed
        const chargeNeeded = vehicle.minimum_charge - vehicle.level - 0.25; // remove 0.25 because then we likely end on the correct percentage
        const timeNeeded = await this.chargeDuration(
          vehicle.vehicle_uuid,
          vehicle.location_uuid,
          vehicle.level,
          vehicle.minimum_charge
        );

        log(
          LogLevel.Trace,
          `emergency charge ${
            vehicle.vehicle_uuid
          }: chargeNeeded:${chargeNeeded}%, timeNeeded: ${timeNeeded / 1e3}`
        );
        plan = [
          {
            chargeStart: null,
            chargeStop: new Date(now + timeNeeded),
            level: vehicle.minimum_charge,
            chargeType: ChargeType.minimum,
            comment: `emergency charge`
          }
        ];

        this.setSmartStatus(
          vehicle,
          (vehicle.connected
            ? `Direct charging to `
            : `Connect charger to charge to `) +
            `${vehicle.minimum_charge}% (est. ${prettyTime(timeNeeded / 1e3)})`
        );
      }

      if (vehicle.level <= vehicle.maximum_charge) {
        let learning = false;

        if (!stats || !stats.level_charge_time) {
          // Disable smart charging because without threshold and averages it can not make a good decision
          log(LogLevel.Debug, `Missing stats for smart charging.`);
          learning = true;
        } else {
          // ****** ANALYSE AND THINK ABOUT IT!  ******

          // Take the time when we connected and compare that to connections for the past 4 weeks
          // how much battery level did we use from those drives until next connection
          // now compare that to the average use between connections and go with the greatest number

          const guess: {
            charge: number;
            before: number;
          } = await this.db.pg.one(
            `WITH connections AS (
                SELECT connected_id, start_ts, end_ts,
                    end_level-(SELECT start_level FROM connected B WHERE B.vehicle_uuid = A.vehicle_uuid AND B.connected_id > A.connected_id ORDER BY connected_id LIMIT 1) as used					 
                FROM connected A
                WHERE end_ts >= current_date - interval '4 weeks' AND vehicle_uuid = $1 AND location_uuid is not null
            ), similar_connections AS (
                SELECT target,(SELECT connected_id FROM connections WHERE end_ts > target.target AND end_ts < target.target + interval '1 week' ORDER BY end_ts LIMIT 1)
                FROM generate_series(NOW() - interval '4 weeks', NOW() - interval '1 week', '1 week') as target
            ), past_weeks AS (
                SELECT CASE WHEN end_ts::time < current_time THEN current_date + interval '1 day' + end_ts::time ELSE current_date + end_ts::time END as before,
                used FROM similar_connections JOIN connections ON (similar_connections.connected_id = connections.connected_id)
            )
            SELECT 
                GREATEST(
                    (SELECT AVG(used) FROM connections WHERE end_ts > current_date - interval '1 week'),
                    (SELECT percentile_cont(0.6) WITHIN GROUP (ORDER BY used) as used FROM past_weeks)
                ) as charge,
                (SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY extract(epoch from before)) FROM past_weeks) as before;`,
            [vehicle.vehicle_uuid]
          );

          if (!guess.before || !guess.charge) {
            // missing data to guess
            log(LogLevel.Debug, `Missing data for smart charging.`);
            learning = true;
          } else {
            const minimumLevel = Math.min(
              vehicle.maximum_charge,
              Math.round(vehicle.minimum_charge + guess.charge + 5) // add 5% to avoid spiraling down
            );
            const neededCharge = minimumLevel - vehicle.level;
            const before = guess.before * 1e3; // epoch to ms

            this.setSmartStatus(
              vehicle,
              `Predicting battery level ${minimumLevel}% (${
                neededCharge > 0 ? Math.round(neededCharge) + "%" : "no"
              } charge) is needed before ${new Date(before).toISOString()}`
            );

            log(
              LogLevel.Debug,
              `Current level: ${vehicle.level}, predicting ${minimumLevel}% (${
                vehicle.minimum_charge
              }+${guess.charge}) is needed before ${new Date(
                before
              ).toISOString()}`
            );

            // Routine charging
            const p = await this.generateChargePlan(
              vehicle,
              minimumLevel,
              before,
              ChargeType.routine,
              `routine charge`
            );
            plan.push(...p);

            // Focus settings charging
            if (vehicle.anxiety_level) {
              const anxietyLevel =
                vehicle.anxiety_level > 1
                  ? vehicle.maximum_charge
                  : Math.round(
                      minimumLevel + (vehicle.maximum_charge - minimumLevel) / 2
                    );

              const p = await this.generateChargePlan(
                vehicle,
                anxietyLevel,
                before,
                ChargeType.prefered,
                `charge setting`
              );
              plan.push(...p);
            }
          }
        }

        if (learning) {
          plan.push({
            chargeStart: null,
            chargeStop: null,
            level: vehicle.maximum_charge,
            chargeType: ChargeType.fill,
            comment: `learning`
          }); // run free

          this.setSmartStatus(
            vehicle,
            `Smart charging disabled (still learning)`
          );
        }
      }

      // Trip charging
      if (vehicle.scheduled_trip) {
        const trip = ScheduleToJS(vehicle.scheduled_trip);
        if (now > trip.time.getTime() + 3600e3) {
          // remove trip 1 hour after the fact
          await this.db.pg.none(
            `UPDATE vehicle SET scheduled_trip = null WHERE vehicle_uuid = $1;`,
            [vehicle.vehicle_uuid]
          );
        } else {
          const tripLevel = Math.min(trip.level, vehicle.maximum_charge);
          const topupTime = await this.chargeDuration(
            vehicle.vehicle_uuid,
            vehicle.location_uuid,
            tripLevel,
            trip.level
          );
          const topupStart =
            trip.time.getTime() - TRIP_TOPUP_MARGIN - topupTime;

          const p = await this.generateChargePlan(
            vehicle,
            tripLevel,
            topupStart,
            ChargeType.trip,
            `upcoming trip`
          );
          plan.push(...p);

          if (topupTime > 0) {
            plan.push({
              chargeStart: new Date(topupStart),
              chargeStop: null,
              level: trip.level,
              chargeType: ChargeType.trip,
              comment: `topping up before trip`
            });
            if (now >= topupStart) {
              this.setSmartStatus(
                vehicle,
                (vehicle.connected
                  ? `Trip charging `
                  : `Connect charger to charge `) +
                  `from ${tripLevel}% to ${trip.level}% (est. ${prettyTime(
                    topupTime / 1e3
                  )})`
              );
            }
          }
        }
      }

      // Low price fill charging
      {
        const p = await this.lowPriceFill(vehicle, stats);
        plan.push(...p);
      }
    }

    if (plan.length) {
      plan = Logic.cleanupPlan(plan);
      log(LogLevel.Trace, plan);
    }
    await this.db.pg.one(
      `UPDATE vehicle SET charge_plan = $1:json WHERE vehicle_uuid = $2 RETURNING *;`,
      [plan.length > 0 ? plan : null, vehicle.vehicle_uuid]
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

  public async priceListRefreshed(price_code: string) {
    const dblist = await this.db.pg.manyOrNone(
      `SELECT v.* FROM vehicle v JOIN location l ON (l.account_uuid = v.account_uuid) WHERE l.price_code = $1;`,
      [price_code]
    );
    for (const v of dblist) {
      await this.refreshVehicleChargePlan(v);
    }
  }
}
