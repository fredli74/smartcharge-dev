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
  DBLocationData
} from "./db-schema";
import { log, LogLevel, geoDistance, generateToken } from "@shared/utils";

import config from "@shared/smartcharge-config.json";
import {
  Vehicle,
  Provider,
  Account,
  Location,
  VehicleToJS,
  VehicleDebugInput
} from "@shared/gql-types";

export const INTERNAL_SERVICE_UUID = `00000000-0000-0000-0000-000000000000`;

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

export class DBInterface {
  public pg: pgp.IDatabase<unknown>;
  constructor() {
    const pg = pgp(config.DB_OPTIONS);
    this.pg = pg(config.DB_CONNECTION);
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
        api_token: generateToken(48)
      }
    );
    log(LogLevel.Info, `Internal agency api_token is: ${k.api_token}`);
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
      geoFenceRadius: l.radius
    };
  }
  public async lookupKnownLocation(
    accountUUID: string,
    latitude: number,
    longitude: number
  ): Promise<Location | null> {
    const locations: DBLocation[] = await this.pg.manyOrNone(
      `SELECT * FROM location WHERE account_uuid = $1;`,
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
  public async getLocation(
    accountUUID: string | undefined,
    locationUUID: string
  ): Promise<DBLocation> {
    if (accountUUID !== undefined) {
      return await this.pg.one(
        `SELECT * FROM location WHERE account_uuid = $1 AND location_uuid = $2`,
        [accountUUID, locationUUID]
      );
    } else {
      return await this.pg.one(
        `SELECT * FROM location WHERE location_uuid = $1`,
        [locationUUID]
      );
    }
  }
  public async getLocations(accountUUID: string): Promise<DBLocation[]> {
    return await this.pg.manyOrNone(
      `SELECT * FROM location WHERE account_uuid = $1`,
      [accountUUID]
    );
  }
  public async updateLocationPrice(
    locationUUID: string,
    ts: Date,
    price: number
  ): Promise<DBLocationData> {
    const result = await this.pg.one(
      `INSERT INTO location_data(location_uuid, ts, price) VALUES($1, $2, $3) ` +
        `ON CONFLICT (location_uuid,ts) DO UPDATE SET price=EXCLUDED.price RETURNING *;`,
      [locationUUID, ts, price * 1e5]
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
      tripSchedule: v.scheduled_trip,
      pausedUntil: v.charging_paused,
      geoLocation: {
        latitude: v.location_micro_latitude / 1e6,
        longitude: v.location_micro_longitude / 1e6
      },
      location: v.location_uuid,
      batteryLevel: v.level || 0,
      odometer: Math.trunc(v.odometer) || 0,
      outsideTemperature: v.outside_deci_temperature / 10,
      isDriving: v.driving || false,
      isConnected: v.connected || false,
      chargePlan: v.charge_plan,
      chargingTo: v.charging_to,
      estimatedTimeLeft: v.estimate,
      status: v.status || "",
      smartStatus: v.smart_status || "",
      updated: v.updated,
      providerData: v.provider_data
    });
  }
  public async newVehicle(
    account_uuid: string,
    name: string | undefined,
    minimum_charge: number,
    maximum_charge: number,
    provider_data?: any
  ): Promise<DBVehicle> {
    debugger;
    const fields: any = {
      account_uuid,
      name,
      minimum_charge,
      maximum_charge,
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

  public async getVehicle(
    vehicle_uuid: string,
    account_uuid?: string
  ): Promise<DBVehicle> {
    const [values, where] = queryHelper([
      [vehicle_uuid, `vehicle_uuid = $1`],
      [account_uuid, `account_uuid = $2`]
    ]);
    return await this.pg.one(
      `SELECT * FROM vehicle WHERE ${where.join(" AND ")}`,
      values
    );
  }
  public async getVehicles(accountUUID: string): Promise<DBVehicle[]> {
    return await this.pg.manyOrNone(
      `SELECT * FROM vehicle WHERE account_uuid = $1`,
      [accountUUID]
    );
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
    provider_data: any | undefined
  ): Promise<DBVehicle> {
    debugger;
    const [values, set] = queryHelper([
      vehicle_uuid,
      [name, `name = $2`],
      [minimum_charge, `minimum_charge = $3`],
      [maximum_charge, `maximum_charge = $4`],
      [provider_data, `provider_data = jsonb_strip_nulls(provider_data || $5)`]
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
    return this.pg.one(`SELECT * FROM account WHERE api_token = $1`, [
      api_token
    ]);
  }
}
