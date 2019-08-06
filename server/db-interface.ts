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

import config from "@shared/smartcharge-config";
import {
  Vehicle,
  Account,
  Location,
  VehicleToJS,
  VehicleDebugInput,
  ProviderSubject,
  GeoLocation
} from "@shared/gql-types";

export const DB_OPTIONS = {};
export const INTERNAL_SERVICE_UUID = `b085e774-1582-4334-be3b-f52d5803e718`;
export const SINGLE_USER_UUID = `c60053d3-a99c-44f2-9104-a10db8eba916`;

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
      providerData: l.provider_data
    };
  }
  public async newLocation(
    account_uuid: string,
    name: string | undefined,
    location: GeoLocation,
    radius: number,
    provider_data?: any
  ): Promise<DBLocation> {
    const fields: any = {
      account_uuid,
      name,
      location_micro_latitude: location.latitude * 1e6,
      location_micro_longitude: location.longitude * 1e6,
      radius,
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
    account_uuid: string | undefined,
    location_uuid?: string
  ): Promise<DBLocation[]> {
    const [values, where] = queryHelper([
      [location_uuid, `location_uuid = $1`],
      [account_uuid, `account_uuid = $2`]
    ]);
    return this.pg.manyOrNone(
      `SELECT * FROM location WHERE ${where.join(" AND ")};`,
      values
    );
  }
  public async getLocation(
    location_uuid: string,
    account_uuid?: string // Used as access limiter
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
      [provider_data, `provider_data = jsonb_strip_nulls(provider_data || $6)`]
    ]);
    assert(set.length > 0);

    return this.pg.one(
      `UPDATE location SET ${set.join(
        ","
      )} WHERE location_uuid = $1 RETURNING *;`,
      values
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
      providerData: v.provider_data
    });
  }
  public async newVehicle(
    account_uuid: string,
    name: string,
    minimum_charge: number,
    maximum_charge: number,
    provider_data: any
  ): Promise<DBVehicle> {
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

  public async getVehicles(
    account_uuid: string | undefined,
    vehicle_uuid?: string
  ): Promise<DBVehicle[]> {
    const [values, where] = queryHelper([
      [vehicle_uuid, `vehicle_uuid = $1`],
      [account_uuid, `account_uuid = $2`]
    ]);
    return this.pg.manyOrNone(
      `SELECT * FROM vehicle WHERE ${where.join(" AND ")};`,
      values
    );
  }

  public async getVehicle(
    vehicle_uuid: string,
    account_uuid?: string // Used as access limiter
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
    scheduled_trip: any | null | undefined,
    charging_paused: Date | null | undefined,
    status: string | undefined,
    provider_data: any | undefined
  ): Promise<DBVehicle> {
    const [values, set] = queryHelper([
      vehicle_uuid,
      [name, `name = $2`],
      [minimum_charge, `minimum_charge = $3`],
      [maximum_charge, `maximum_charge = $4`],
      [scheduled_trip, `scheduled_trip = $5`],
      [charging_paused, `charging_paused = $6`],
      [status, `status = $7`],
      [provider_data, `provider_data = jsonb_strip_nulls(provider_data || $8)`]
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

  public async getProviderSubjects(
    accountUUID: string | undefined,
    accept: string[] | undefined
  ): Promise<ProviderSubject[]> {
    const [values, where] = queryHelper([
      [accountUUID, `account_uuid = $1`],
      [accept, `provider_name IN ($2:csv)`]
    ]);

    assert(where.length > 0);

    const dblist = await this.pg.manyOrNone(
      `WITH subjects AS (
        SELECT account_uuid, vehicle_uuid as subject_uuid, provider_data, 'vehicle' as provider_type, provider_data->>'provider' as provider_name FROM vehicle
        UNION
        SELECT account_uuid, location_uuid as subject_uuid, provider_data, 'location' as provider_type, provider_data->>'provider' as provider_name FROM location
      )
      SELECT * FROM subjects WHERE ${where.join(" AND ")};`,
      values
    );
    return dblist.map(
      f =>
        <ProviderSubject>{
          ownerID: f.account_uuid,
          subjectID: f.subject_uuid,
          providerType: f.provider_type,
          providerName: f.provider_name,
          providerData: f.provider_data
        }
    );
  }

  public async getChartData(
    location_uuid: string,
    interval: number
  ): Promise<DBLocationData[]> {
    return this.pg.manyOrNone(
      `WITH data AS (SELECT * FROM location_data WHERE location_uuid = $1)
      SELECT * FROM data WHERE ts > (SELECT max(ts) FROM data) - interval $2 ORDER BY ts;`,
      [location_uuid, `${interval} hours`]
    );
  }
}
