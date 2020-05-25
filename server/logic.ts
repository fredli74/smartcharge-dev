/**
 * @file Server Logic for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
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
  DBLocationStats,
  DBStatsMap,
  DBSchedule
} from "./db-schema";
import {
  LogLevel,
  log,
  arrayMean,
  prettyTime,
  compareStartStopTimes,
  numericStartTime,
  numericStopTime,
  compareStartTimes
} from "@shared/utils";
import {
  UpdateVehicleDataInput,
  ChargePlan,
  Schedule
} from "./gql/vehicle-type";
import { SmartChargeGoal, ChargeType, ScheduleType } from "@shared/sc-types";
import {
  MIN_STATS_PERIOD,
  TRIP_TOPUP_MARGIN
} from "@shared/smartcharge-defines";
import { plainToClass } from "class-transformer";

export class Logic {
  constructor(private db: DBInterface) {}
  public init() {}

  public async updateVehicleData(
    input: UpdateVehicleDataInput,
    now: Date = new Date()
  ) {
    // First lookup old record
    const vehicle: DBVehicle = await this.db.getVehicle(undefined, input.id);
    log(LogLevel.Trace, `vehicle: ${JSON.stringify(vehicle)}`);

    // Convert API values to database values
    const data = {
      latitude: input.geoLocation.latitude * 1e6, // 6 decimals precision to integer
      longitude: input.geoLocation.longitude * 1e6, // 6 decimals precision to integer
      level: input.batteryLevel, // in %
      odometer: input.odometer, // in meter
      outside_temp: input.outsideTemperature
        ? input.outsideTemperature * 10 // celsius to deci-celsius (20.5 = 205)
        : vehicle.outside_deci_temperature,
      inside_temp: input.insideTemperature
        ? input.insideTemperature * 10 // celsius to deci-celsius (20.5 = 205)
        : vehicle.inside_deci_temperature,
      climate_control: input.climateControl, // boolean
      driving: input.isDriving, // boolean
      connected: input.connectedCharger, // ac|dc|null
      charging_to: input.chargingTo, // in %
      estimate: input.estimatedTimeLeft || 0, // estimated time in minutes to complete charge
      power: (input.powerUse || 0) * 1e3, // current power drain kW to W
      added: (input.energyAdded || 0) * 60e3 // added kWh to Wm (1000 * 60)
    };

    // Setup stats record
    const statsDelta = (now.getTime() - vehicle.updated.getTime()) / 1e3;
    const statsData: DBStatsMap = {
      vehicle_uuid: vehicle.vehicle_uuid,
      period: MIN_STATS_PERIOD,
      stats_ts: new Date(
        Math.floor(now.getTime() / MIN_STATS_PERIOD) * MIN_STATS_PERIOD
      ),
      minimum_level: data.level,
      maximum_level: data.level,
      driven_seconds: data.driving ? statsDelta : 0,
      driven_meters:
        vehicle.odometer > 0 ? data.odometer - vehicle.odometer : 0,
      // all charge info is filled in below
      charged_seconds: 0,
      charge_energy: 0,
      charge_cost: 0,
      charge_cost_saved: 0
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
        currentLocationUUID = location.location_uuid;
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
            saved: 0,
            connected: true
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
          const deltaChargeTime =
            (now.getTime() - charge.end_ts.getTime()) / 1e3; // ms / 1000 = s
          const deltaPowerUsed = Math.round(
            Math.max(0, data.power * deltaChargeTime) / 60
          ); // used = power (W) * time (s) = Ws / 60 = Wm
          connection.energy_used += deltaPowerUsed;

          {
            let cost = 0;
            let saved = 0;
            const priceLookup: {
              price_now: number;
              price_then: number;
            } = await this.db.pg.one(
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
              cost = Math.round(
                (priceLookup.price_now * deltaPowerUsed) / 60e3
              ); // price in (kWh) * used in (Wm)   Wm / 60e3 => kWh

              if (priceLookup.price_then !== null) {
                saved = Math.round(
                  ((priceLookup.price_then - priceLookup.price_now) *
                    deltaPowerUsed) /
                    60e3
                );
              }
            }

            connection.cost += cost;
            connection.saved += saved;

            // Update stats with charge information
            if (deltaChargeTime < statsDelta * 2) {
              // Just a sanity check that we do not update stats with old data
              statsData.charge_cost = cost;
              statsData.charge_cost_saved = saved;
              statsData.charged_seconds = statsDelta;
              statsData.charge_energy = deltaPowerUsed;
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
              update.energy_used = charge.energy_used + deltaPowerUsed;
              update.end_added = data.added;
            }
            log(
              LogLevel.Debug,
              `Updating charge ${vehicle.charge_id} with ${deltaPowerUsed} Wm used in ${deltaChargeTime}s`
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
                  (now.getTime() - current.start_ts.getTime()) / 1e3; // ms / 1000 = s
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
            location_uuid: vehicle.location_uuid, // if a new location was added
            end_ts: now,
            end_level: data.level,
            energy_used: connection.energy_used,
            cost: connection.cost,
            saved: connection.saved,
            connected: Boolean(data.connected)
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
        // Remove manual charge entries if we have any
        await this.db.pg.none(
          `DELETE FROM schedule WHERE vehicle_uuid = $1 AND schedule_type = $2;`,
          [vehicle.vehicle_uuid, ScheduleType.Manual]
        );

        if (connection.location_uuid !== null) {
          await this.createNewStats(vehicle, connection.location_uuid);
        }
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
              `Removing trip ${trip.trip_id}, because it only recorded ${trip.distance} meters`
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

    // Update statsMap
    if (statsDelta > 0 && statsDelta < 60 * 60) {
      // Limit statsDelta to 1 hour for data sanity during polling loss
      await Promise.all([
        this.updateStatsMap(statsData, 5), // 5 minute stats bucket
        this.updateStatsMap(statsData, 60), // hourly stats bucket
        this.updateStatsMap(statsData, 24 * 60) // daily stats bucket
      ]);
    }

    // Update charge plan if needed
    if (doPricePlan) {
      await this.refreshChargePlan(input.id);
    }
  }

  public async updateStatsMap(data: DBStatsMap, period: number) {
    return this.db.pg.one(
      `INSERT INTO stats_map($[this:name]) VALUES ($[this:csv])
          ON CONFLICT(vehicle_uuid, period, stats_ts) DO UPDATE SET
              minimum_level=LEAST(stats_map.minimum_level, EXCLUDED.minimum_level),
              maximum_level=GREATEST(stats_map.maximum_level, EXCLUDED.maximum_level),
              driven_seconds=stats_map.driven_seconds + EXCLUDED.driven_seconds,
              driven_meters=stats_map.driven_meters + EXCLUDED.driven_meters,
              charged_seconds=stats_map.charged_seconds + EXCLUDED.charged_seconds,
              charge_energy=stats_map.charge_energy + EXCLUDED.charge_energy,
              charge_cost=stats_map.charge_cost + EXCLUDED.charge_cost,
              charge_cost_saved=stats_map.charge_cost_saved + EXCLUDED.charge_cost_saved
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
        charge_cost_saved: data.charge_cost_saved
      }
    );
  }

  public async createNewStats(
    vehicle: DBVehicle,
    location_uuid: string
  ): Promise<DBLocationStats | null> {
    const level_charge_time: number | null = (
      await this.db.pg.oneOrNone(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) as seconds
            FROM charge a JOIN charge_curve b ON (a.charge_id = b.charge_id)
            WHERE a.vehicle_uuid = $1 AND location_uuid = $2`,
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
    if (
      avg_prices.price_data_ts === null ||
      avg_prices.avg7 === null ||
      avg_prices.avg21 === null
    )
      return null;

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
        SELECT connected_id,location_uuid,start_level,end_level,needed,hour,LEAST(1.0,
          EXTRACT(epoch FROM hour+interval '1 hour'-start_ts)/3600,
          EXTRACT(epoch FROM end_ts-hour)/3600
        ) as fraction, price,price/(avg7+(avg7-avg21)/2) as threshold
        FROM period
        JOIN connections ON (hour >= date_trunc('hour',start_ts) AND hour <= date_trunc('hour',end_ts))
        JOIN my_price_data ON (ts = hour)
        JOIN week_avg ON (day = date_trunc('day', hour))
      )
      SELECT * FROM connection_map ORDER BY connected_id,hour;`,
        [vehicle.vehicle_uuid, location_uuid]
      );
      for (const h of history) {
        if (
          historyMap.length < 1 ||
          historyMap[historyMap.length - 1].connected_id !== h.connected_id
        ) {
          historyMap.push({
            connected_id: h.connected_id,
            start_level: h.start_level,
            needed: h.needed,
            offsite: h.location_uuid !== location_uuid,
            hours: []
          });
        }
        if (h.location_uuid === location_uuid) {
          historyMap[historyMap.length - 1].hours.push({
            hour: h.hour,
            fraction: h.fraction,
            price: h.price,
            threshold: h.threshold
          });
        }
      }
    }

    if (historyMap.length > 0) {
      // Charge simulation
      const locationSettings =
        vehicle.location_settings[location_uuid] ||
        DBInterface.DefaultVehicleLocationSettings();

      const minimum_charge = locationSettings.directLevel;
      const maximum_charge = vehicle.maximum_charge;

      const thresholdList = historyMap
        .reduce(
          (p, c) => [...c.hours.map(h => h.threshold), ...p],
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
          neededLevel = Math.min(
            100,
            minimum_charge +
              (historyMap[i].needed > 0 ? historyMap[i].needed * 1.1 : needavg)
          );

          let smartCharging = false;

          while (hours.length > 0) {
            if (lvl >= minimum_charge && !smartCharging) {
              hours = hours.sort((a, b) => a.threshold - b.threshold);
              smartCharging = true;
            }
            const h = hours.shift()!;
            const charge = Math.max(
              h.threshold <= t ? maximum_charge - lvl : 0,
              lvl < neededLevel ? neededLevel - lvl : 0
            );
            if (charge > 0) {
              const chargeTime = Math.min(
                3600 * h.fraction,
                charge * level_charge_time
              );
              const newLevel = Math.min(
                100,
                lvl + chargeTime / level_charge_time
              );
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
          log(
            LogLevel.Trace,
            `Cost simulation ${vehicle.vehicle_uuid} t=${t} => ${f}`
          );
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
        threshold: Math.round(threshold * 100)
      }
    );
  }

  public async currentStats(
    vehicle: DBVehicle,
    location_uuid: string
  ): Promise<DBLocationStats | null> {
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

  private async chargeDuration(
    vehicleUUID: string,
    locationUUID: string | null,
    from: number,
    to: number
  ) {
    // TODO: do we need to consider temperature?
    const chargeCurve = await this.db.getChargeCurve(vehicleUUID, locationUUID);
    let sum = 0;
    for (let level = from; level <= to; ++level) {
      sum +=
        chargeCurve[Math.min(100, Math.ceil(level))] *
        (level < to ? 1.0 : 0.75); // remove 25% of the last % to not overshoot
    }
    return sum * 1e3;
  }

  private static cleanupPlan(plan: ChargePlan[]): ChargePlan[] {
    const chargePrio = {
      [ChargeType.Calibrate]: 0,
      [ChargeType.Minimum]: 1,
      [ChargeType.Manual]: 2,
      [ChargeType.Trip]: 3,
      [ChargeType.Routine]: 4,
      [ChargeType.Prefered]: 5,
      [ChargeType.Fill]: 6
    };
    plan.sort(
      (a, b) =>
        compareStartStopTimes(
          a.chargeStart,
          a.chargeStop,
          b.chargeStart,
          b.chargeStop
        ) || chargePrio[a.chargeType] - chargePrio[b.chargeType]
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
            // Merge them
            if (numericStopTime(b.chargeStop) > numericStopTime(a.chargeStop)) {
              a.chargeStop = b.chargeStop;
            }
            a.level = Math.max(a.level, b.level);
            plan.splice(i + 1, 1);
            --i;
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

    // Second pass to shift start times for continous charging
    {
      let shifted = false;
      for (let i = 0; i < plan.length - 1; ++i) {
        const a = plan[i];
        const b = plan[i + 1];
        const shift = Math.min(
          // max shift between this segment end and next segment start
          // nextStart - thisStop
          numericStartTime(b.chargeStart) - numericStopTime(a.chargeStop),
          // or maximum shift possible within the current hour
          // hour - (stop - start) => start - stop + hour
          numericStartTime(a.chargeStart) -
            numericStopTime(a.chargeStop) +
            3600e3
        );

        if (
          shift > 0 &&
          numericStopTime(a.chargeStop) + shift >=
            numericStartTime(b.chargeStart)
        ) {
          a.chargeStop = b.chargeStart;
          a.chargeStart = new Date(numericStartTime(a.chargeStart) + shift);
          shifted = true;
        }
      }

      if (shifted) {
        consolidate();
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

  private async ChargePlanEntry(
    vehicle: DBVehicle,
    level: number,
    chargeType: ChargeType,
    comment: string
  ): Promise<ChargePlan> {
    const timeNeeded = await this.chargeDuration(
      vehicle.vehicle_uuid,
      vehicle.location_uuid,
      vehicle.level,
      level
    );
    log(
      LogLevel.Trace,
      `ChargePlanEntry ${
        vehicle.vehicle_uuid
      }: ${chargeType} chargeNeeded:${level -
        vehicle.level}%, timeNeeded: ${timeNeeded / 1e3}`
    );

    return {
      chargeStart: null,
      chargeStop: new Date(Date.now() + timeNeeded),
      level,
      chargeType,
      comment
    } as ChargePlan;
  }

  private async generateChargePlan(
    vehicle: DBVehicle,
    batteryLevel: number,
    chargeType: ChargeType,
    comment: string,
    before?: number,
    maxPrice?: number
  ): Promise<ChargePlan[]> {
    assert(vehicle.location_uuid !== undefined);
    assert(vehicle.location_uuid !== null);

    const now = Date.now();

    let plan: ChargePlan[] = [];

    const timeNeeded = await this.chargeDuration(
      vehicle.vehicle_uuid,
      vehicle.location_uuid,
      vehicle.level,
      batteryLevel
    );

    before = before || 10e13; // >200 years into the future

    if (timeNeeded > 0) {
      // Get our future price map
      const priceMap: {
        ts: Date;
        price: number;
      }[] = await this.db.pg.manyOrNone(
        `SELECT ts, price FROM price_data p JOIN location l ON (l.price_list_uuid = p.price_list_uuid) WHERE location_uuid = $1 AND ts >= NOW() - interval '1 hour' AND ts < $2 ORDER BY price`,
        [vehicle.location_uuid, new Date(before)]
      );

      if (priceMap.length > 0) {
        let timeLeft = timeNeeded;
        for (const price of priceMap) {
          if (timeLeft <= 0) break;
          if (maxPrice && price.price > maxPrice) break;

          const ts = price.ts.getTime();
          const start = ts < now ? now : ts;
          const fullHour = ts + 60 * 60 * 1e3;
          const end = Math.min(start + timeLeft, before, fullHour);
          const chargeStart = ts < start ? new Date(ts) : new Date(start);
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
          chargeType: ChargeType.Routine,
          comment: comment
        });
      }
    }
    return plan;
  }

  private async updateAIschedule(
    vehicle_uuid: string,
    before: Date | null,
    level: number | null
  ): Promise<null> {
    return this.db.pg.none(
      `WITH upsert AS (UPDATE schedule SET schedule_ts=$3, level=$4 WHERE vehicle_uuid=$1 AND schedule_type = $2 RETURNING *)
      INSERT INTO schedule(vehicle_uuid, schedule_type, schedule_ts, level) SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT * FROM upsert);`,
      [vehicle_uuid, ScheduleType.AI, before, level]
    );
  }

  private async refreshVehicleChargePlan(vehicle: DBVehicle) {
    log(LogLevel.Trace, `vehicle: ${JSON.stringify(vehicle)}`);

    if (vehicle.location_uuid === null && !vehicle.connected) {
      // Do not touch charge plan if not connected and not near known location
      log(LogLevel.Trace, `Vehicle at unknown location`);
      return this.setSmartStatus(vehicle, ``);
    }

    const now = Date.now();

    const locationSettings =
      (vehicle.location_uuid &&
        vehicle.location_settings[vehicle.location_uuid]) ||
      DBInterface.DefaultVehicleLocationSettings();
    const minimum_charge = locationSettings.directLevel;

    // Cleanup schedule remove all entries 1 hour after the end time
    const schedule: DBSchedule[] = await this.db.pg.manyOrNone(
      `DELETE FROM schedule WHERE vehicle_uuid = $1 AND schedule_ts + interval '1 hour' < NOW();
      SELECT * FROM schedule WHERE vehicle_uuid = $1;`,
      [vehicle.vehicle_uuid]
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

    let plan: ChargePlan[] = [];
    let smartStatus = "";

    if (manual && manual.level === 0) {
      // Manually stopped charging
      log(LogLevel.Trace, `Smart charging disabled until next connection`);
      smartStatus = `Smart charging disabled until next plug in`;
    } else {
      let disconnectTime: number = 0;
      let stats: DBLocationStats | null = null;

      if (vehicle.charge_plan) {
        // Find and keep emergency charge if we had one
        plan = plainToClass(
          ChargePlan,
          vehicle.charge_plan as ChargePlan[]
        ).filter(f => {
          // keep emergency charge so that it is not stopped just as it touches minimum_level
          return f.chargeStart === null && vehicle.level < minimum_charge + 1;
        });
      }

      if (vehicle.level < minimum_charge) {
        // Emergency charge up to minimum level
        plan = [
          await this.ChargePlanEntry(
            vehicle,
            minimum_charge,
            ChargeType.Minimum,
            `emergency charge`
          )
        ];

        smartStatus =
          (vehicle.connected
            ? `Direct charging to `
            : `Connect charger to charge to `) + `${minimum_charge}%`;
      }

      if (manual) {
        if (manual.time) {
          disconnectTime = manual.time!.getTime();
          const p = await this.generateChargePlan(
            vehicle,
            manual.level,
            ChargeType.Manual,
            "manual charge",
            disconnectTime
          );
          plan.push(...p);
          log(
            LogLevel.Trace,
            `Manual charging directly to ${
              manual.level
            }% before ${manual.time.toISOString()}`
          );
        } else {
          plan.push(
            await this.ChargePlanEntry(
              vehicle,
              manual.level,
              ChargeType.Manual,
              `manual charge`
            )
          );
          log(LogLevel.Trace, `Manual charging directly to ${manual.level}%`);
        }
        smartStatus = smartStatus || `Manual charging to ${manual.level}%`;
      } else if (vehicle.location_uuid) {
        stats = await this.currentStats(
          vehicle.vehicle_uuid,
          vehicle.location_uuid
        );
        log(LogLevel.Trace, `stats: ${JSON.stringify(stats)}`);

        // Check charge calibration
        // TODO: remake charge calibration, use stats if found, and vehicle reported estimate if not
        /*const maxLevel = (
          await this.db.pg.one(
            `SELECT MAX(level) as max_level FROM charge a JOIN charge_curve b ON(a.charge_id = b.charge_id)
              WHERE a.vehicle_uuid = $1 AND a.location_uuid = $2;`,
            [vehicle.vehicle_uuid, vehicle.location_uuid]
          )
        ).max_level;
        if (vehicle.level < vehicle.maximum_charge && (maxLevel || 0) < 100) {
          plan = [
            {
              chargeStart: null,
              chargeStop: null,
              level: 100,
              chargeType: ChargeType.Calibrate,
              comment: "Charge calibration"
            }
          ];
          smartStatus = smartStatus || `Charge calibration needed at current location`;
        } else {*/

        if (vehicle.level <= vehicle.maximum_charge) {
          let learning = false;

          if (!stats || !stats.level_charge_time) {
            // Disable smart charging because without threshold and averages it can not make a good decision
            log(LogLevel.Debug, `Missing stats for smart charging.`);
            learning = true;
          } else {
            /*
             ****** ANALYSE AND THINK ABOUT IT!  ******
             */

            const guess: {
              charge: number;
              before: number;
            } = await this.db.pg.one(
              `WITH connections AS (
                  -- all connections for specific vehicle_uuid and location_uuid
                  SELECT connected_id, start_ts, end_ts, connected, end_ts-start_ts as duration, end_level-start_level as charged,
                    end_level-(SELECT start_level FROM connected B WHERE B.vehicle_uuid = A.vehicle_uuid AND B.connected_id > A.connected_id ORDER BY connected_id LIMIT 1) as used
                  FROM connected A WHERE vehicle_uuid = $1 AND location_uuid = $2

                ), ref_time AS ( 
                  -- latest connection time as base reference, or current time if not connected or 24h have passed
                  SELECT COALESCE((SELECT MAX(start_ts) FROM connections WHERE connected AND start_ts > NOW() - interval '1 day'), NOW()) AS start_ts,
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
                      AND end_ts > series_start_ts+(duration/2)
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
                    CASE WHEN GREATEST((SELECT not_before_ts FROM ref_time), (SELECT start_ts FROM ref_time)+(duration/2)) >= remapped_target_ts
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
                vehicle.location_uuid,
                null /*scheduleMap[ScheduleType.Guide] &&
                    scheduleMap[ScheduleType.Guide].time*/
              ]
            );

            if (!guess.before || !guess.charge) {
              // missing data to guess
              log(LogLevel.Debug, `Missing data for smart charging.`);
              learning = true;
            } else {
              const minimumLevel = Math.min(
                vehicle.maximum_charge,
                Math.round(minimum_charge + guess.charge + 5) // add 5% to avoid spiraling down
              );
              const neededCharge = minimumLevel - vehicle.level;
              const before = guess.before * 1e3; // epoch to ms
              disconnectTime = before;

              this.updateAIschedule(
                vehicle.vehicle_uuid,
                new Date(before),
                minimumLevel
              );

              smartStatus =
                smartStatus ||
                `Predicting battery level ${minimumLevel}% (${
                  neededCharge > 0 ? Math.round(neededCharge) + "%" : "no"
                } charge) is needed before ${new Date(before).toISOString()}`;
              log(
                LogLevel.Debug,
                `Current level: ${
                  vehicle.level
                }, predicting ${minimumLevel}% (${minimum_charge}+${
                  guess.charge
                }) is needed before ${new Date(before).toISOString()}`
              );

              // Routine charging
              const p = await this.generateChargePlan(
                vehicle,
                minimumLevel,
                ChargeType.Routine,
                "routine charge",
                before
              );
              plan.push(...p);

              // locations settings charging
              {
                const goal =
                  (locationSettings && locationSettings.goal) ||
                  SmartChargeGoal.Balanced;
                let goalLevel =
                  goal === SmartChargeGoal.Full
                    ? vehicle.maximum_charge
                    : goal === SmartChargeGoal.Low
                    ? 0
                    : Math.min(
                        vehicle.maximum_charge,
                        Math.max(
                          minimumLevel,
                          parseInt(goal) ||
                            Math.round(
                              minimumLevel +
                                (vehicle.maximum_charge - minimumLevel) / 2
                            )
                        )
                      );

                if (goalLevel > minimumLevel) {
                  const p = await this.generateChargePlan(
                    vehicle,
                    goalLevel,
                    ChargeType.Prefered,
                    `charge setting`,
                    before
                  );
                  plan.push(...p);
                }
              }
            }
          }

          if (learning) {
            plan.push({
              chargeStart: null,
              chargeStop: null,
              level: vehicle.maximum_charge,
              chargeType: ChargeType.Fill,
              comment: `learning`
            }); // run free

            this.updateAIschedule(vehicle.vehicle_uuid, null, null);

            smartStatus =
              smartStatus || `Smart charging disabled (still learning)`;
          }
        }
      }

      // Trip charging
      if (trip && trip.time) {
        debugger; // check trip, it was a ScheduleToJS
        const departure = trip.time!.getTime();

        if (now > departure - 36 * 3600e3) {
          // ignore trips that are more than 36 hours away
          const departLevel = trip.level;
          const prepareLevel = Math.max(
            vehicle.level,
            Math.min(departLevel, vehicle.maximum_charge)
          );
          const topupTime =
            departLevel > prepareLevel
              ? await this.chargeDuration(
                  vehicle.vehicle_uuid,
                  vehicle.location_uuid,
                  prepareLevel,
                  departLevel
                )
              : 0;
          const topupStart = departure - TRIP_TOPUP_MARGIN - topupTime;
          disconnectTime = Math.max(disconnectTime, topupStart);

          const p = await this.generateChargePlan(
            vehicle,
            prepareLevel,
            ChargeType.Trip,
            `upcoming trip`,
            topupStart
          );
          plan.push(...p);

          if (topupTime > 0) {
            plan.push({
              chargeStart: new Date(topupStart),
              chargeStop: null,
              level: departLevel,
              chargeType: ChargeType.Trip,
              comment: `topping up before trip`
            });
            if (now >= topupStart) {
              smartStatus =
                (vehicle.connected
                  ? `Trip charging `
                  : `Connect charger to charge `) +
                `from ${prepareLevel}% to ${departLevel}% (est. ${prettyTime(
                  topupTime / 1e3
                )})`;
            }
          }
        }
      }

      // Low price fill charging
      if (
        stats &&
        stats.weekly_avg7_price &&
        stats.weekly_avg21_price &&
        stats.threshold
      ) {
        const averagePrice =
          stats.weekly_avg7_price +
          (stats.weekly_avg7_price - stats.weekly_avg21_price) / 2;
        const thresholdPrice = (averagePrice * stats.threshold) / 100;

        const p = await this.generateChargePlan(
          vehicle,
          vehicle.maximum_charge,
          ChargeType.Fill,
          "low price",
          disconnectTime,
          thresholdPrice
        );
        plan.push(...p);
      }
    }

    if (smartStatus) {
      this.setSmartStatus(vehicle, smartStatus);
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
