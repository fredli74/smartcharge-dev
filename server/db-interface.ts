/**
 * @file Data handler (core server) for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { strict as assert } from "assert";

import pgp from "pg-promise";
import {
  DBVehicle,
  DBLocation,
  DB_SETUP_TSQL,
  DBVehicleDebug,
  DBAccount,
  DB_VERSION,
  DBPriceList,
  DBServiceProvider
} from "./db-schema";
import { log, LogLevel, geoDistance, generateToken } from "@shared/utils";
import config from "@shared/smartcharge-config";
import { Location, GeoLocation } from "./gql/location-type";
import { Vehicle, VehicleToJS, VehicleDebugInput } from "./gql/vehicle-type";
import { Account } from "./gql/account-type";
import { ServiceProvider } from "./gql/service-type";
import uuidv5 from "uuid/v5";

export const DB_OPTIONS = {};

const SMARTCHARGE_NAMESPACE = uuidv5("account.smartcharge.dev", uuidv5.DNS);
export function makeAccountUUID(subject: string, domain: string): string {
  return uuidv5(`${subject}.${domain}`, SMARTCHARGE_NAMESPACE);
}
export const SINGLE_USER_UUID = makeAccountUUID("SINGLE_USER", "*");
export const INTERNAL_SERVICE_UUID = makeAccountUUID("INTERNAL_SERVICE", "*");

function queryWhere(where: string[]): string {
  if (where.length > 0) {
    return ` WHERE ${where.join(" AND ")} `;
  }
  return "";
}
function queryHelper(fields: any[]): [any[], string[]] {
  let values: any[] = [];
  let where: string[] = [];
  for (const f of fields) {
    if (Array.isArray(f)) {
      values.push(f[0]);
      if (f[0] !== undefined && f[1] !== undefined) where.push(f[1]);
    } else {
      values.push(f);
    }
  }
  return [values, where];
}

export interface ChargeCurve {
  [level: number]: number;
}

export class DBInterface {
  public pg: pgp.IDatabase<unknown>;
  constructor() {
    const pg = pgp(DB_OPTIONS);
    this.pg = pg({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_SSL === "true"
    });
  }
  public async init() {
    let version = "";
    log(LogLevel.Info, `Checking database`);
    try {
      version = await this.getDatabaseVersion();
      if (version !== DB_VERSION) {
        throw "Database is out of date. No automatic upgrade script found.";
      }
    } catch (err) {
      if (err.code === "42P01") {
        // PostgreSQL error code for parserOpenTable
        log(LogLevel.Info, `No tables found, running database setup script`);
        await this.setupDatabase();
        version = await this.getDatabaseVersion();
      } else {
        throw err;
      }
    }
    log(LogLevel.Debug, `Database version ${version} detected`);

    // Start maintainance task
    this.maintainanceWorker();
  }

  public maintainanceWorker() {
    let nextCleanup = 0;
    let orphanServices: { [service_uuid: string]: boolean } = {};

    setInterval(async () => {
      const now = Date.now();
      if (now > nextCleanup) {
        {
          for (const o of await this.pg.manyOrNone(
            `SELECT * FROM service_provider WHERE 
            NOT EXISTS (SELECT * FROM vehicle WHERE vehicle.service_uuid = service_provider.service_uuid) AND 
            NOT EXISTS (SELECT * FROM location WHERE location.service_uuid = service_provider.service_uuid);`
          )) {
            if (orphanServices[o.service_uuid]) {
              log(
                LogLevel.Info,
                `Deleting orphan ${o.provider_name} service_provider ${
                  o.service_uuid
                }`
              );
              await this.pg.none(
                `DELETE FROM service_provider WHERE service_uuid = $1;`,
                [o.service_uuid]
              );
            } else {
              orphanServices[o.service_uuid] = true;
            }
          }
        }

        nextCleanup = now + 3600e3; // 1 hour
      }
    }, 60e3);
  }
  public async getDatabaseVersion(): Promise<string> {
    return (await this.pg.one(
      `SELECT value FROM setting WHERE key = 'version';`
    )).value;
  }
  public async setupDatabase(): Promise<void> {
    for (const q of DB_SETUP_TSQL) {
      log(LogLevel.Trace, q);
      await this.pg.result(q);
    }

    // Creating the internal agency user
    const k = await this.pg.one(
      `INSERT INTO account($[this:name]) VALUES($[this:csv]) RETURNING *;`,
      {
        account_uuid: INTERNAL_SERVICE_UUID,
        name: "internal",
        api_token: process.env["INTERNAL_SERVICE_TOKEN"] || generateToken(48)
      }
    );
    log(LogLevel.Info, `Internal agency api_token is: ${k.api_token}`);

    // Creating the single user
    await this.pg.one(
      `INSERT INTO account($[this:name]) VALUES($[this:csv]) RETURNING *;`,
      {
        account_uuid: SINGLE_USER_UUID,
        name: "single user",
        api_token: generateToken(48)
      }
    );
  }

  public static DBLocationToLocation(l: DBLocation): Location {
    return {
      id: l.location_uuid,
      name: l.name,
      ownerID: l.account_uuid,
      geoLocation: {
        latitude: l.location_micro_latitude / 1e6,
        longitude: l.location_micro_longitude / 1e6
      },
      geoFenceRadius: l.radius,
      serviceID: l.service_uuid,
      providerData: l.provider_data
    };
  }
  public async newLocation(
    account_uuid: string,
    name: string | undefined,
    location: GeoLocation,
    radius: number,
    price_code: string,
    provider_data: any
  ): Promise<DBLocation> {
    const fields: any = {
      account_uuid,
      name,
      location_micro_latitude: location.latitude * 1e6,
      location_micro_longitude: location.longitude * 1e6,
      radius,
      price_code,
      provider_data
    };
    for (const key of Object.keys(fields)) {
      if (fields[key] === undefined) {
        delete fields[key];
      }
    }
    const result = await this.pg.one(
      `INSERT INTO location($[this:name]) VALUES($[this:csv]) RETURNING *;`,
      fields
    );
    await this.updateAllLocations(account_uuid);
    return result;
  }

  public async lookupKnownLocation(
    accountUUID: string,
    latitude: number,
    longitude: number
  ): Promise<Location | null> {
    const locations: DBLocation[] = await this.pg.manyOrNone(
      `SELECT * FROM location WHERE account_uuid = $1 ORDER BY name, location_uuid;`,
      [accountUUID]
    );
    let bestLocation = null;
    let bestDistance = Number.MAX_VALUE;
    for (const loc of locations)
      if (loc.location_uuid !== null) {
        const distance = geoDistance(
          latitude / 1e6,
          longitude / 1e6,
          loc.location_micro_latitude / 1e6,
          loc.location_micro_longitude / 1e6
        );
        log(
          LogLevel.Trace,
          `Distance to location ${loc.name} is ${distance} meters`
        );
        if (distance < loc.radius && distance < bestDistance) {
          bestLocation = loc;
          bestDistance = distance;
        }
      }
    if (bestLocation === null) {
      return null;
    }
    return DBInterface.DBLocationToLocation(bestLocation);
  }
  public async updateAllLocations(accountUUID: string) {
    for (const v of await this.getVehicles(accountUUID)) {
      const location = await this.lookupKnownLocation(
        v.account_uuid,
        v.location_micro_latitude,
        v.location_micro_longitude
      );
      this.pg.none(
        `UPDATE vehicle SET location_uuid=$1 WHERE vehicle_uuid=$2;`,
        [location ? location.id : null, v.vehicle_uuid]
      );
    }
  }

  public async getLocations(
    account_uuid: string | null | undefined,
    location_uuid?: string
  ): Promise<DBLocation[]> {
    const [values, where] = queryHelper([
      [location_uuid, `location_uuid = $1`],
      [account_uuid, `account_uuid = $2`]
    ]);
    return this.pg.manyOrNone(
      `SELECT * FROM location ${queryWhere(
        where
      )} ORDER BY name, location_uuid;`,
      values
    );
  }
  public async getLocation(
    account_uuid: string | null | undefined,
    location_uuid: string
  ): Promise<DBLocation> {
    const dblist = await this.getLocations(account_uuid, location_uuid);
    if (dblist.length === 0) {
      throw new Error(`Unknown location id ${location_uuid}`);
    }
    assert(dblist.length === 1);
    return dblist[0];
  }

  public async updateLocation(
    location_uuid: string,
    name: string | undefined,
    location: GeoLocation | undefined,
    radius: number | undefined,
    price_code: string | undefined,
    service_uuid: string | undefined,
    provider_data: any | undefined
  ): Promise<DBLocation> {
    const [values, set] = queryHelper([
      location_uuid,
      [name, `name = $2`],
      [
        location ? location.latitude * 1e6 : undefined,
        `location_micro_latitude = $3`
      ],
      [
        location ? location.longitude * 1e6 : undefined,
        `location_micro_longitude = $4`
      ],
      [radius, `radius = $5`],
      [price_code, `price_code = $6`],
      [service_uuid, `service_uuid = $7`],
      [provider_data, `provider_data = jsonb_strip_nulls(provider_data || $8)`]
    ]);
    assert(set.length > 0);

    return this.pg.one(
      `UPDATE location SET ${set.join(
        ","
      )} WHERE location_uuid = $1 RETURNING *;`,
      values
    );
  }

  public async updatePriceList(
    price_code: string,
    ts: Date,
    price: number
  ): Promise<DBPriceList> {
    const result = await this.pg.one(
      `INSERT INTO price_list(price_code, ts, price) VALUES($1, $2, $3) ` +
        `ON CONFLICT (price_code,ts) DO UPDATE SET price=EXCLUDED.price RETURNING *;`,
      [price_code, ts, price * 1e5]
    );
    return result;
  }

  public static DBVehicleToVehicle(v: DBVehicle): Vehicle {
    // TODO: Remove all the "|| default" conversions, a record should always be populated first time
    // either by the database insert or the function that adds the vehicle
    return VehicleToJS(<Vehicle>{
      id: v.vehicle_uuid,
      ownerID: v.account_uuid,
      name: v.name,
      minimumLevel: Math.trunc(v.minimum_charge),
      maximumLevel: Math.trunc(v.maximum_charge),
      anxietyLevel: v.anxiety_level,
      tripSchedule: v.scheduled_trip,
      pausedUntil: v.smart_pause,
      geoLocation: {
        latitude: v.location_micro_latitude / 1e6,
        longitude: v.location_micro_longitude / 1e6
      },
      location: v.location_uuid,
      batteryLevel: v.level || 0,
      odometer: Math.trunc(v.odometer) || 0,
      outsideTemperature: v.outside_deci_temperature / 10,
      insideTemperature: v.inside_deci_temperature / 10,
      climateControl: v.climate_control,
      isDriving: v.driving,
      isConnected: v.connected,
      chargePlan: v.charge_plan,
      chargingTo: v.charging_to,
      estimatedTimeLeft: v.estimate,
      status: v.status,
      smartStatus: v.smart_status,
      updated: v.updated,
      serviceID: v.service_uuid,
      providerData: v.provider_data
    });
  }
  public async newVehicle(
    account_uuid: string,
    name: string,
    minimum_charge: number,
    maximum_charge: number,
    service_uuid: string,
    provider_data: any
  ): Promise<DBVehicle> {
    const fields: any = {
      account_uuid,
      name,
      minimum_charge,
      maximum_charge,
      anxiety_level: 1,
      service_uuid,
      provider_data
    };
    for (const key of Object.keys(fields)) {
      if (fields[key] === undefined) {
        delete fields[key];
      }
    }
    return await this.pg.one(
      `INSERT INTO vehicle($[this:name]) VALUES($[this:csv]) RETURNING *;`,
      fields
    );
  }

  public async getVehicles(
    account_uuid: string | null | undefined,
    vehicle_uuid?: string
  ): Promise<DBVehicle[]> {
    const [values, where] = queryHelper([
      [vehicle_uuid, `vehicle_uuid = $1`],
      [account_uuid, `account_uuid = $2`]
    ]);
    return this.pg.manyOrNone(
      `SELECT * FROM vehicle ${queryWhere(where)} ORDER BY name, vehicle_uuid;`,
      values
    );
  }

  public async getVehicle(
    account_uuid: string | null | undefined,
    vehicle_uuid: string
  ): Promise<DBVehicle> {
    const dblist = await this.getVehicles(account_uuid, vehicle_uuid);
    if (dblist.length === 0) {
      throw new Error(`Unknown vehicle id ${vehicle_uuid}`);
    }
    assert(dblist.length === 1);
    return dblist[0];
  }

  public async setVehicleStatus(
    vehicleUUID: string,
    status: string
  ): Promise<DBVehicle> {
    return this.pg.one(
      `UPDATE vehicle SET status = $2 WHERE vehicle_uuid = $1 RETURNING *;`,
      [vehicleUUID, status]
    );
  }
  public async storeVehicleDebug(
    record: DBVehicleDebug
  ): Promise<DBVehicleDebug> {
    return this.pg.one(
      `INSERT INTO vehicle_debug(vehicle_uuid, ts, category, data) VALUES($1, $2, $3, $4) RETURNING *;`,
      [record.vehicle_uuid, record.ts, record.category, record.data]
    );
  }
  public async updateVehicle(
    vehicle_uuid: string,
    name: string | undefined,
    minimum_charge: number | undefined,
    maximum_charge: number | undefined,
    anxiety_level: number | undefined,
    scheduled_trip: any | null | undefined,
    smart_pause: Date | null | undefined,
    status: string | undefined,
    service_uuid: string | undefined,
    provider_data: any | undefined
  ): Promise<DBVehicle> {
    const [values, set] = queryHelper([
      vehicle_uuid,
      [name, `name = $2`],
      [minimum_charge, `minimum_charge = $3`],
      [maximum_charge, `maximum_charge = $4`],
      [anxiety_level, `anxiety_level = $5`],
      [scheduled_trip, `scheduled_trip = $6`],
      [smart_pause, `smart_pause = $7`],
      [status, `status = $8`],
      [service_uuid, `service_uuid = $9`],
      [provider_data, `provider_data = jsonb_strip_nulls(provider_data || $10)`]
    ]);
    assert(set.length > 0);

    return this.pg.one(
      `UPDATE vehicle SET ${set.join(
        ","
      )} WHERE vehicle_uuid = $1 RETURNING *;`,
      values
    );
  }
  public static VehicleDebugToDBVehicleDebug(
    record: VehicleDebugInput
  ): DBVehicleDebug {
    return {
      vehicle_uuid: record.id,
      category: record.category,
      ts: record.timestamp,
      data: record.data
    };
  }

  public static DBAccountToAccount(a: DBAccount): Account {
    return { id: a.account_uuid, name: a.name, token: a.api_token };
  }
  public async getAccount(accountUUID: string): Promise<DBAccount> {
    return this.pg.one(`SELECT * FROM account WHERE account_uuid = $1;`, [
      accountUUID
    ]);
  }
  public async lookupAccount(api_token: string): Promise<DBAccount> {
    return this.pg.one(`SELECT * FROM account WHERE api_token = $1;`, [
      api_token
    ]);
  }
  public async makeAccount(
    account_uuid: string,
    name: string
  ): Promise<DBAccount> {
    // Creating the single user
    return this.pg.one(
      `INSERT INTO account($[this:name]) VALUES($[this:csv]) RETURNING *;`,
      { account_uuid, name, api_token: generateToken(48) }
    );
  }

  public async getServiceProviders(
    account_uuid: string | null | undefined,
    accept: string[] | undefined
  ): Promise<ServiceProvider[]> {
    const [values, where] = queryHelper([
      [account_uuid, `account_uuid = $1`],
      [accept, `provider_name IN ($2:csv)`]
    ]);
    assert(where.length > 0);

    const dblist = (await this.pg.manyOrNone(
      `SELECT * FROM service_provider WHERE ${where.join(
        " AND "
      )} ORDER BY 1,2;`,
      values
    )) as DBServiceProvider[];

    return dblist.map(
      f =>
        <ServiceProvider>{
          ownerID: f.account_uuid,
          providerName: f.provider_name,
          serviceData: f.service_data,
          serviceID: f.service_uuid
        }
    );
  }

  public async getChartData(
    location_uuid: string,
    interval: number
  ): Promise<DBPriceList[]> {
    return this.pg.manyOrNone(
      `WITH data AS (
        SELECT p.* FROM price_list p JOIN location l ON (l.price_code = p.price_code)
        WHERE location_uuid = $1
      )
      SELECT * FROM data WHERE ts > (SELECT max(ts) FROM data) - interval $2 ORDER BY ts;`,
      [location_uuid, `${interval} hours`]
    );
  }

  public async getChargeCurve(
    vehicle_uuid: string,
    location_uuid: string
  ): Promise<ChargeCurve> {
    const dbCurve = await this.pg.manyOrNone(
      `SELECT level, percentile_cont(0.5) WITHIN GROUP(ORDER BY duration) AS seconds
            FROM charge a JOIN charge_curve b ON(a.charge_id = b.charge_id)
            WHERE a.vehicle_uuid = $1 AND a.location_uuid = $2 GROUP BY level ORDER BY level;`,
      [vehicle_uuid, location_uuid]
    );
    let current;
    if (dbCurve.length > 0) {
      current = dbCurve.shift()!.seconds;
    } else {
      current =
        (await this.pg.one(
          `SELECT AVG(duration) FROM charge a JOIN charge_curve b ON (a.charge_id = b.charge_id) WHERE a.vehicle_uuid = $1 AND location_uuid = $2;`,
          [vehicle_uuid, location_uuid]
        )).avg ||
        (await this.pg.one(
          `SELECT AVG(60.0 * estimate / (target_level-end_level)) FROM charge WHERE end_level < target_level AND vehicle_uuid = $1 AND location_uuid = $2;`,
          [vehicle_uuid, location_uuid]
        )).avg ||
        20 * 60; // 20 min default for first time charge
    }
    assert(current !== undefined && current !== null);

    let curve: ChargeCurve = {};
    for (let level = 0; level <= 100; ++level) {
      while (dbCurve.length > 0 && level >= dbCurve[0].level) {
        current = dbCurve.shift()!.seconds;
      }
      curve[level] = current;
    }
    return curve;
  }

  public async setChargeCurve(
    vehicle_uuid: string,
    charge_id: number,
    level: number,
    duration: number,
    outside_deci_temperature: number | undefined,
    energy_used: number | undefined,
    energy_added: number | undefined
  ) {
    const input: any = {
      vehicle_uuid,
      charge_id,
      level,
      duration
    };
    if (outside_deci_temperature !== undefined) {
      input.outside_deci_temperature = outside_deci_temperature;
    }
    if (energy_used !== undefined) {
      input.energy_used = energy_used;
    }
    if (energy_added !== undefined) {
      input.energy_added = energy_added;
    }

    return this.pg.one(
      `INSERT INTO charge_curve($[this:name]) VALUES ($[this:csv])
          ON CONFLICT(vehicle_uuid,level,charge_id) DO UPDATE SET
          outside_deci_temperature = EXCLUDED.outside_deci_temperature,
          duration = EXCLUDED.duration,
          energy_used = EXCLUDED.energy_used,
          energy_added = EXCLUDED.energy_added
        RETURNING *;`,
      input
    );
  }
  public async chargeCalibration(vehicle_uuid: string, charge_id: number) {
    return (await this.pg.one(
      `SELECT MAX(level) as level FROM charge a JOIN charge_curve b ON(a.charge_id = b.charge_id)
      WHERE a.vehicle_uuid = $1 AND a.location_uuid = (SELECT location_uuid FROM charge c WHERE c.charge_id = $2);`,
      [vehicle_uuid, charge_id]
    )).level;
  }
}
