/**
 * @file Utilities for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

export enum LogLevel {
  Silent = 0,
  Error,
  Warning,
  Info,
  Debug,
  Trace
}

export const logSymbol = [" ", "!", "*", ".", "(", "?"];

export let LOGLEVEL = LogLevel.Trace;
export function setLogLevel(level: LogLevel) {
  LOGLEVEL = level;
}

export function log(level: LogLevel, data: any) {
  if (level <= LOGLEVEL) {
    const s = logFormat(level, data);
    switch (level) {
      case LogLevel.Error:
      case LogLevel.Warning:
        console.error(s);
        break;
      case LogLevel.Info:
        console.log(s);
        break;
      case LogLevel.Debug:
      case LogLevel.Trace:
        console.debug(s);
        break;
    }
  }
}
export function logFormat(level: LogLevel, data: any): string {
  return `${new Date().toISOString()} ${logSymbol[level]} ${
    data instanceof Error
      ? (data as Error).message
      : typeof data === "object"
      ? JSON.stringify(data)
      : data
  }`;
}

export function arrayMean(list: number[]) {
  return list.length > 0
    ? list.reduce((prev, curr) => prev + curr) / list.length
    : 0;
}
export function arrayPercentile(list: number[], percentile: number) {
  const sorted = list.sort();
  const pos = (sorted.length - 1) * percentile;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  } else {
    return sorted[base];
  }
}
export function arrayMedian(list: number[]) {
  return arrayPercentile(list, 0.5);
}

/**
 * geoDistance calculates the great-circle distance (in meters) between two points
 * on earth using the haversine formula
 *  a = sin²(Δφ/2) + cos(φ1)⋅cos(φ2)⋅sin²(Δλ/2)
 *  δ = 2·atan2(√(a), √(1−a))
 * thanks to: Chris Veness for publishing www.movable-type.co.uk/scripts/latlong.html
 */
export function geoDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) {
  const radius = 6371e3; // Earth radius 6371 km
  const φ1 = (lat1 * Math.PI) / 180; // latitude (in radians)
  const φ2 = (lat2 * Math.PI) / 180; // latitude (in radians)
  const Δφ = ((lat2 - lat1) * Math.PI) / 180; // delta degrees between latitude points (in radians)
  const Δλ = ((lon2 - lon1) * Math.PI) / 180; // delta degrees between longitude points (in radians)

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const δ = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * δ;
}

import { randomBytes } from "crypto";
export function generateToken(bytes: number): string {
  const token = randomBytes(bytes);
  return token.toString("base64");
}

export class MemCache {
  private mem: { [key: string]: { expiry: number; data: any } } = {};
  public async get(
    key: any,
    expiry: number,
    callback: () => Promise<any>
  ): Promise<any> {
    const jkey = JSON.stringify(key);
    if (this.mem[jkey] === undefined || this.mem[jkey].expiry > Date.now()) {
      this.mem[jkey] = { expiry: Date.now() + expiry, data: await callback() };
    }
    return this.mem[jkey];
  }
  public clear() {
    this.mem = {};
  }
  public gc() {
    for (const a in this.mem) {
      if (this.mem[a].expiry > Date.now()) {
        delete this.mem[a];
      }
    }
  }
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function prettyTime(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes >= 1) {
    const hours = minutes / 60;
    if (hours >= 1) {
      const days = hours / 24;
      if (days >= 1) {
        const weeks = days / 7;
        if (weeks >= 1) {
          return `${Math.round(weeks)}w`;
        } else {
          return `${Math.round(days)}d`;
        }
      } else {
        return `${Math.round(hours)}h`;
      }
    } else {
      return `${Math.round(minutes)}m`;
    }
  } else {
    return `${Math.round(seconds)}s`;
  }
}

export function mergeURL(
  base: string | undefined,
  relative: string | undefined
): string {
  return !relative
    ? base || ""
    : !base
    ? relative
    : base.replace(/\/+$/, "") + "/" + relative.replace(/^\/+/, "");
}

export function secondsToString(
  span: number,
  precision?: number,
  roundUp?: boolean
): string {
  precision = precision || 1;
  const factors = [1, 60, 60 * 60, 24 * 60 * 60];
  {
    let i = 0;
    for (; i < factors.length && span > factors[i]; ++i);
    i = Math.max(0, i - precision);

    if (roundUp) {
      span = Math.ceil(span / factors[i]) * factors[i];
    } else {
      span = Math.floor(span / factors[i]) * factors[i];
    }
  }

  const decompose = [];
  for (let s = span, i = factors.length - 1; i >= 0; --i) {
    const v = Math.floor(s / factors[i]);
    s -= v * factors[i];
    decompose.push(v);
  }
  const units = ["day", "hour", "minute", "second"];
  const pretty = decompose.map((f, i) => {
    return f > 0 ? `${f} ${units[i]}${f > 1 ? "s" : ""}` : "";
  });
  return pretty.join(" ").trim() || "now";
}

import md5 from "md5";
import { DateTime } from "luxon";
export function makePublicID(id: string, len?: number): string {
  return md5("public+" + id).substr(0, len || 8);
}

export type OpenDate = Date | null | string | undefined;

// Functions for comparing start and stop times that can be a Date or null
export function numericStartTime(nstart: OpenDate): number {
  return nstart instanceof Date
    ? nstart.getTime()
    : typeof nstart === "string"
    ? new Date(nstart).getTime()
    : -Infinity;
}
export function numericStopTime(nstop: OpenDate): number {
  return nstop instanceof Date
    ? nstop.getTime()
    : typeof nstop === "string"
    ? new Date(nstop).getTime()
    : Infinity;
}
export function compareStartTimes(a: OpenDate, b: OpenDate): number {
  return numericStartTime(a) - numericStartTime(b);
}
export function compareStopTimes(a: OpenDate, b: OpenDate): number {
  return numericStopTime(b) - numericStopTime(a);
}
export function compareStartStopTimes(
  a_start: OpenDate,
  a_stop: OpenDate,
  b_start: OpenDate,
  b_stop: OpenDate
): number {
  return (
    compareStartTimes(a_start, b_start) || compareStopTimes(a_stop, b_stop)
  );
}

export async function asyncFilter<T>(
  array: Array<T>,
  callbackfn: (value: T, index: number, array: T[]) => unknown
): Promise<T[]> {
  const results = await Promise.all(array.map(callbackfn));
  return array.filter((_v, index) => results[index]);
}

export function relativeTime(when: Date): { date: string; time: string } {
  const nowLocal = DateTime.local();
  const thenLocal = DateTime.fromJSDate(when).toLocal();

  const dayDiff = thenLocal
    .startOf("day")
    .diff(nowLocal.startOf("day"))
    .as("days");

  let datestr = "";
  if (dayDiff === -1) {
    datestr = "yesterday";
  } else if (dayDiff === 0) {
    datestr = "today";
  } else if (dayDiff === 1) {
    datestr = "tomorrow";
  } else if (dayDiff > 0 && dayDiff < 7) {
    datestr = thenLocal.weekdayLong.toLowerCase();
  } else if (dayDiff > 0 && dayDiff < 260) {
    datestr = thenLocal.toFormat("MMM dd");
  } else {
    datestr = thenLocal.toFormat("DD");
  }
  return { date: datestr, time: thenLocal.toFormat("HH:mm") };
}
