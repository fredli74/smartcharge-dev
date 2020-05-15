/**
 * @file Central server database schema for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

export const DB_VERSION = `1.0-beta`;

type PlainObject = Record<string, any>;

export abstract class DBAccount {
  account_uuid!: string; // account uuid
  name!: string; // account name
  api_token!: string; // API-token for data access
}
const DBAccount_TSQL = `CREATE TABLE scserver.account
    (
        account_uuid uuid DEFAULT sequential_uuid(),
        name character varying(64) NOT NULL,
        api_token character varying(64) NOT NULL,
        CONSTRAINT account_pkey PRIMARY KEY (account_uuid)
    );`;

export abstract class DBLocation {
  location_uuid!: string; // location uuid
  account_uuid!: string; // account identifier
  name!: string; // name of location
  location_micro_latitude!: number; // 6 decimal precision converted to integer
  location_micro_longitude!: number; // 6 decimal precision converted to integer
  radius!: number; // radius tollerance (in meters)
  price_code!: string | null; // price list code
  service_uuid!: string | null; // provider uuid
  provider_data!: PlainObject; // provider custom data
}
const DBLocation_TSQL = `CREATE TABLE scserver.location
    (
        location_uuid uuid DEFAULT sequential_uuid(),
        account_uuid uuid NOT NULL,
        name text NOT NULL,
        location_micro_latitude integer NOT NULL,
        location_micro_longitude integer NOT NULL,
        radius integer NOT NULL,
        price_code character varying(32),
        service_uuid uuid,
        provider_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT location_pkey PRIMARY KEY(location_uuid),
        CONSTRAINT location_fkey FOREIGN KEY(account_uuid)
                REFERENCES account(account_uuid) MATCH SIMPLE
                ON UPDATE RESTRICT
                ON DELETE CASCADE
    );`;

export abstract class DBPriceData {
  // price_list_uuid!: string; // price list identifier
  price_code!: string; // location identifer
  ts!: Date; // price tariff starts at
  price!: number; // cost per kWh
}
const DBPriceData_TSQL = `CREATE TABLE scserver.price_data
    (
        /*price_list_uuid uuid NOT NULL,*/
        price_code character varying(32) NOT NULL,
        ts timestamp(0) with time zone NOT NULL,
        price integer NOT NULL,
        CONSTRAINT price_data_pkey PRIMARY KEY (price_code, ts)
    );`;

export abstract class DBVehicle {
  vehicle_uuid!: string; // vehicle uuid
  account_uuid!: string; // account identifier
  service_uuid!: string | null; // provider uuid
  name!: string; // name of vehicle
  maximum_charge!: number; // maximum normal (non trip) charge
  schedule!: PlainObject; // schedule
  provider_data!: PlainObject; // provider custom data
  location_micro_latitude!: number | null; // 6 decimal precision converted to integer
  location_micro_longitude!: number | null; // 6 decimal precision converted to integer
  location_uuid!: string | null; // known location id
  location_settings!: PlainObject; // location settings (or null)
  level!: number; // current battery charge level %
  odometer!: number; // odometer (in meter)
  outside_deci_temperature!: number; // temperature (deci-celsius)
  inside_deci_temperature!: number; // temperature (deci-celsius)
  climate_control!: boolean; // climate control on
  connected!: boolean; // connected to charger
  connected_id!: number | null; // current charge session id
  charging_to!: number | null; // currently charging to level %
  estimate!: number | null; // estimated time left (in minutes)
  charge_id!: number | null; // current charge session id
  driving!: boolean; // currently driving
  trip_id!: number | null; // current trip session id
  status!: string; // informative status string
  smart_status!: string; // smart charging information
  charge_plan!: any | null; // current charge plan (or null)
  updated!: Date; // timestamp of last record update
}
const DBVehicle_TSQL = `CREATE TABLE scserver.vehicle
    (
        vehicle_uuid uuid NOT NULL DEFAULT sequential_uuid(),
        account_uuid uuid NOT NULL,
        service_uuid uuid,
        name text COLLATE NOT NULL,
        maximum_charge smallint NOT NULL,
        schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
        provider_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        location_micro_latitude integer,
        location_micro_longitude integer,
        location_uuid uuid,
        location_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        level smallint NOT NULL DEFAULT 0,
        odometer integer NOT NULL DEFAULT 0,
        outside_deci_temperature smallint NOT NULL DEFAULT 0,
        inside_deci_temperature smallint NOT NULL DEFAULT 0,
        climate_control boolean NOT NULL DEFAULT false,
        connected boolean NOT NULL DEFAULT false,
        connected_id integer,
        charging_to integer,
        estimate integer,
        charge_id integer,
        driving boolean NOT NULL DEFAULT false,
        trip_id integer,
        status text COLLATE NOT NULL DEFAULT ''::text,
        smart_status text COLLATE NOT NULL DEFAULT ''::text,
        charge_plan jsonb,
        updated timestamp(0) with time zone NOT NULL DEFAULT now(),
        CONSTRAINT vehicle_pkey PRIMARY KEY (vehicle_uuid),
        CONSTRAINT vehicle_fkey FOREIGN KEY (account_uuid)
            REFERENCES account (account_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBVehicleDebug {
  vehicle_uuid!: string; // vehicle identifier
  ts!: Date; // timestamp
  category!: string; // debug category
  data: any; // variable data payload
}
const DBVehicleDebug_TSQL = `CREATE TABLE scserver.vehicle_debug
    (
        vehicle_uuid uuid NOT NULL,
        ts timestamp(0) with time zone NOT NULL,
        category character varying(64),
        data jsonb,
        CONSTRAINT vehicle_debug_pkey PRIMARY KEY (vehicle_uuid,ts),
        CONSTRAINT vehicle_debug_fkey FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBServiceProvider {
  account_uuid!: string; // account uuid
  provider_name!: string; // provider name
  service_uuid!: string; // provider uuid
  service_data!: any; // service data
}
const DBServiceProvider_TSQL = `CREATE TABLE scserver.service_provider
    (
        service_uuid uuid DEFAULT sequential_uuid(),
        account_uuid uuid NOT NULL,
        provider_name character varying(64) NOT NULL,
        service_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT provider_pkey PRIMARY KEY (service_uuid),
        CONSTRAINT provider_fkey FOREIGN KEY (account_uuid)
            REFERENCES account (account_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBSleep {
  sleep_id!: number; // sleep id
  vehicle_uuid!: string; // vehicle identifier
  active!: boolean; // are we still sleeping
  start_ts!: Date; // time when starting
  end_ts!: Date; // time when ending
}
const DBSleep_TSQL = `CREATE TABLE scserver.sleep
    (
        sleep_id integer NOT NULL GENERATED ALWAYS AS IDENTITY,
        vehicle_uuid uuid NOT NULL,
        active boolean NOT NULL,
        start_ts timestamp(0) with time zone NOT NULL,
        end_ts timestamp(0) with time zone NOT NULL,
        CONSTRAINT sleep_pkey PRIMARY KEY (sleep_id),
        CONSTRAINT sleep_fkey FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

/** DBTrip not used anymore, should we stop collecting it?  **/
export abstract class DBTrip {
  trip_id!: number; // trip id
  vehicle_uuid!: string; // vehicle identifier
  start_ts!: Date; // time when starting
  start_level!: number; // charge level when starting (%)
  start_location_uuid!: string | null; // TODO lookup location from coordinates
  start_odometer!: number; // odometer when starting (in meter)
  start_outside_deci_temperature!: number; // temperature at start (deci-celsius)
  end_ts!: Date; // time when ending
  end_level!: number; // charge level when ending (%)
  end_location_uuid!: string | null; // TODO lookup location from coordinates
  distance!: number; // distance travelled (in meter)
}
const DBTrip_TSQL = `CREATE TABLE scserver.trip
    (
        trip_id integer NOT NULL GENERATED ALWAYS AS IDENTITY,
        vehicle_uuid uuid NOT NULL,
        start_ts timestamp(0) with time zone NOT NULL,
        start_level smallint NOT NULL,
        start_location_uuid uuid,
        start_odometer integer NOT NULL,
        start_outside_deci_temperature smallint,
        end_ts timestamp(0) with time zone NOT NULL,
        end_level smallint NOT NULL,
        end_location_uuid uuid,
        distance integer NOT NULL DEFAULT 0,
        CONSTRAINT trip_pkey PRIMARY KEY (trip_id),
        CONSTRAINT trip_fkey FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBConnected {
  connected_id!: number; // charge session id
  vehicle_uuid!: string; // vehicle identifier
  type!: string; // "ac"|"dc"
  location_uuid!: string | null; // location uuid from coordinates
  start_ts!: Date; // timestamp when session started
  start_level!: number; // battery level in % when session started
  start_odometer!: number; // odometer (in meters)
  end_ts!: Date; // timestamp when session stopped (updated continiously)
  end_level!: number; // battery level in % when session stopped (updated continiously)
  energy_used!: number; // approximated energy used in Wm (Watt-minutes)
  cost!: number; // approximated energy cost (in integer currency unit)
  saved!: number; // approximated energy cost saved (in integer currency unit)
  connected!: boolean; // is it still connected
}
const DBChargeSession_TSQL = `CREATE TABLE scserver.connected
    (
        connected_id integer NOT NULL GENERATED ALWAYS AS IDENTITY,
        vehicle_uuid uuid NOT NULL,
        type character varying(32) NOT NULL,
        location_uuid uuid,
        start_ts timestamp(0) with time zone NOT NULL,
        start_level smallint NOT NULL,
        start_odometer integer NOT NULL,
        end_ts timestamp(0) with time zone NOT NULL,
        end_level smallint NOT NULL,
        energy_used integer NOT NULL DEFAULT 0,
        cost integer NOT NULL DEFAULT 0,
        saved integer NOT NULL DEFAULT 0,
        connected boolean NOT NULL,
        CONSTRAINT connected_pkey PRIMARY KEY (connected_id),
        CONSTRAINT connected_fkey FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBCharge {
  charge_id!: number; // charge id
  connected_id!: number; // charge session id
  vehicle_uuid!: string; // vehicle identifier
  type!: string; // "ac"|"dc"
  location_uuid!: string | null; // lookup location from coordinates
  start_ts!: Date; // timestamp when charge started
  start_level!: number; // battery level in % when charge started
  start_added!: number; // energy added in Wm (track this because it does not always reset between charges)
  target_level!: number; // charge target %
  estimate!: number; // estimated time to full charge (in minutes)
  end_ts!: Date; // timestamp when charge stopped (updated continiously)
  end_level!: number; // battery level in % when charge stopped (updated continiously)
  end_added!: number; // energy added in Wm
  energy_used!: number; // approximated energy used in Wm (Watt-minutes)
}
const DBCharge_TSQL = `CREATE TABLE scserver.charge
    (
        charge_id integer NOT NULL GENERATED ALWAYS AS IDENTITY,
        connected_id integer NOT NULL,
        vehicle_uuid uuid NOT NULL,
        type character varying(32) NOT NULL,
        location_uuid uuid,
        start_ts timestamp(0) with time zone NOT NULL,
        start_level smallint NOT NULL,
        start_added integer NOT NULL,
        target_level smallint NOT NULL,
        estimate integer NOT NULL,
        end_ts timestamp(0) with time zone NOT NULL,
        end_level smallint NOT NULL,
        end_added integer NOT NULL,
        energy_used integer NOT NULL DEFAULT 0,
        CONSTRAINT charge_pkey PRIMARY KEY (charge_id),
        CONSTRAINT charge_fkeyA FOREIGN KEY (connected_id)
            REFERENCES connected (connected_id) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE,
        CONSTRAINT charge_fkeyB FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBChargeCurrent {
  charge_id!: number; // charge identifier
  start_ts!: Date; // time when starting
  start_level!: number; // charge level when starting (%)
  start_added!: number; // energy added (Wm) when starting
  powers!: number[]; // array of power (W) readings
  outside_deci_temperatures!: number[]; // array of temperature readings (deci-celsius)
}
// TODO: these fields should be NOT NULL, but we have a sloppt INSERT WHERE NOT EXISTS in logic.ts
const DBChargeCurrent_TSQL = `CREATE TABLE scserver.charge_current
    (
        charge_id integer NOT NULL,
        start_ts timestamp with time zone,
        start_level smallint,
        start_added integer,
        powers integer[],
        outside_deci_temperatures smallint[],
        PRIMARY KEY (charge_id)
    );`;

export abstract class DBChargeCurve {
  vehicle_uuid!: string; // vehicle identifier
  charge_id!: number; // charge identifier
  level!: number; // charge level (%)
  outside_deci_temperature!: number | null; // average temperature (deci-celsius)
  duration!: number; // duration (in seconds)
  energy_used!: number; // approximated energy used in Wm (Watt-minutes)
  energy_added!: number; // energy added in Wm (Watt-minutes)
}
const DBChargeCurve_TSQL = `CREATE TABLE scserver.charge_curve
    (
        vehicle_uuid uuid NOT NULL,
        charge_id integer NOT NULL,
        level smallint NOT NULL,
        outside_deci_temperature smallint,
        duration integer NOT NULL DEFAULT 0,
        energy_used integer NOT NULL DEFAULT 0,
        energy_added integer NOT NULL DEFAULT 0,
        CONSTRAINT charge_curve_pkey PRIMARY KEY (vehicle_uuid,level,charge_id),
        CONSTRAINT charge_curve_fkey FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBLocationStats {
  stats_id!: number; // stats id
  vehicle_uuid!: string; // vehicle uuid
  location_uuid!: string; // location identifer
  updated!: Date; // date when stats where updated
  price_data_ts!: Date; // timestamp of last pricelist data entry
  level_charge_time!: number; // time to charge 1% (in seconds)
  weekly_avg7_price!: number; // weekly running average price (per kWh)
  weekly_avg21_price!: number; // total charging time (in seconds)
  threshold!: number; // price threshold needed to fulfill total charging time
}
const DBLocationStats_TSQL = `CREATE TABLE scserver.location_stats
    (
        stats_id integer NOT NULL GENERATED ALWAYS AS IDENTITY,
        vehicle_uuid uuid NOT NULL,
        location_uuid uuid NOT NULL,
        updated timestamp(0) with time zone NOT NULL DEFAULT NOW(),
        price_data_ts timestamp(0) with time zone NOT NULL,
        level_charge_time integer NOT NULL,
        weekly_avg7_price integer NOT NULL,
        weekly_avg21_price integer NOT NULL,
        threshold integer NOT NULL,
        CONSTRAINT location_stats_pkey PRIMARY KEY (stats_id)
            INCLUDE(vehicle_uuid, location_uuid),
        CONSTRAINT location_stats_fkeyA FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE,
        CONSTRAINT location_stats_fkeyB FOREIGN KEY (location_uuid)
            REFERENCES location (location_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBStatsMap {
  vehicle_uuid!: string; // vehicle identifier
  period!: number; // period interval in minutes
  stats_ts!: Date; // date truncated down to closest period
  minimum_level!: number; // vehicle minimum battery level during the period
  maximum_level!: number; // vehicle maximum battery level during the period
  driven_seconds!: number; // driven seconds during the period
  driven_meters!: number; // driven meters during the period
  charged_seconds!: number; // charging during the period
  charge_energy!: number; // energy used charging in Wm (Watt-minutes) during the period
  charge_cost!: number; // total cost of energy charged
  charge_cost_saved!: number; // estimated cost savings
}
const DBStatsMap_TSQL = `CREATE TABLE scserver.stats_map
    (
        vehicle_uuid uuid NOT NULL,
        period integer NOT NULL,
        stats_ts timestamp(0) with time zone NOT NULL,
        minimum_level integer NOT NULL,
        maximum_level integer NOT NULL,
        driven_seconds integer NOT NULL,
        driven_meters integer NOT NULL,
        charged_seconds integer NOT NULL,
        charge_energy integer NOT NULL,
        charge_cost integer NOT NULL,
        charge_cost_saved integer NOT NULL,
        CONSTRAINT stats_map_pkey PRIMARY KEY(vehicle_uuid,period,stats_ts),
        CONSTRAINT stats_map_fkey FOREIGN KEY (vehicle_uuid)
            REFERENCES vehicle (vehicle_uuid) MATCH SIMPLE
            ON UPDATE RESTRICT
            ON DELETE CASCADE
    );`;

export abstract class DBSetting {
  key!: string; // key
  value!: any; // value (json)
}
const DBSetting_TSQL = `CREATE TABLE scserver.setting
    (
        key character varying(32) NOT NULL,
        value json,
        CONSTRAINT setting_pkey PRIMARY KEY (key)
    );
    INSERT INTO setting(key,value) VALUES('version', '"${DB_VERSION}"');`;

export const DB_SETUP_TSQL = [
  `CREATE SCHEMA IF NOT EXISTS scserver;`,
  `ALTER ROLE current_user SET search_path = "$user",scserver,public;`,

  /*
        PostgreSQL sequential uuid function
        Thanks to Tomas Vondra (https://www.2ndquadrant.com/en/blog/author/tomas-vondra/)
        and PachowStudios (https://gist.github.com/PachowStudios)
    */ `
        CREATE OR REPLACE FUNCTION scserver.sequential_uuid() RETURNS uuid LANGUAGE plpgsql AS $$
        DECLARE
            v_i int;
            v_time bigint;
            v_bytes int[16] = '{}';
            v_hex text[16] = '{}';
        BEGIN
            v_time := floor(extract(epoch FROM clock_timestamp()) / 60);
            v_bytes[1] := v_time >> 8 & 255;
            v_bytes[2] := v_time & 255;

            FOR v_i IN 3..16 LOOP
                v_bytes[v_i] := floor(random() * 256);
            END LOOP;
            FOR v_i IN 1..16 LOOP
                v_hex[v_i] := lpad(to_hex(v_bytes[v_i]), 2, '0');
            END LOOP;
            RETURN array_to_string(v_hex, '');
        END $$;
    `,

  /*
        Deep merge jsonb function
        Thanks to (http://blog.bguiz.com/2017/json-merge-postgresql/)
    */
  `CREATE OR REPLACE FUNCTION scserver.jsonb_merge(orig jsonb, delta jsonb) RETURNS jsonb LANGUAGE sql AS $$
       SELECT
           jsonb_strip_nulls(jsonb_object_agg(
               COALESCE(keyOrig, keyDelta),
               CASE
                   WHEN keyDelta isnull THEN valOrig
                   WHEN (jsonb_typeof(valOrig) <> 'object' or jsonb_typeof(valDelta) <> 'object') THEN valDelta
                   ELSE jsonb_merge(valOrig, valDelta)
               END
           ))
       FROM jsonb_each(orig) e1(keyOrig, valOrig)
       FULL JOIN jsonb_each(delta) e2(keyDelta, valDelta) ON keyOrig = keyDelta
   $$;`,

  DBAccount_TSQL,

  DBLocation_TSQL,
  DBPriceData_TSQL,

  DBVehicle_TSQL,
  DBVehicleDebug_TSQL,

  DBServiceProvider_TSQL,

  DBTrip_TSQL,

  DBSleep_TSQL,

  DBChargeSession_TSQL,
  DBCharge_TSQL,
  DBChargeCurrent_TSQL,
  DBChargeCurve_TSQL,

  DBLocationStats_TSQL,

  DBStatsMap_TSQL,

  DBSetting_TSQL
];
