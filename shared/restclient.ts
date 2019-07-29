/**
 * @file Very simple http/https JSON REST client
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT-0 (MIT No Attribution)
 */

import * as https from "https";
import * as http from "http";
import { mergeURL } from "./utils";

const DEFAULT_AGENT = `RestClient/1.0 (Node.js)`;
const TOKEN_EXPIRATION_WINDOW = 300;

export type IRestToken = {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_at?: number;
};
export type RestToken = string | IRestToken;

function time(): number {
  return Math.floor(new Date().valueOf() / 1000);
}

export interface Options {
  baseURL?: string;
  agent?: string;
  timeout?: number;
}

export interface RestClientResponse {
  status: number;
  headers: any;
  data: any;
}

export class RestClient {
  private httpAgent: http.Agent | undefined;
  private httpsAgent: https.Agent | undefined;
  constructor(private options: Options) {}
  private static parseTokenResponse(data: any): RestToken {
    if (typeof data.access_token !== "string")
      throw `Error parsing invalid OAuth2.0 token response ${JSON.stringify(
        data
      )}`;
    const token: RestToken = {
      access_token: data.access_token,
      token_type: data.token_type || "Bearer"
    };
    if (typeof data.refresh_token === "string") {
      token.refresh_token = data.refresh_token;
    }
    const expires = Number.parseInt(data.expires_in);
    if (Number.isInteger(expires)) {
      token.expires_at = time() + expires - TOKEN_EXPIRATION_WINDOW;
    }
    return token;
  }
  public static tokenExpired(token: RestToken) {
    return (
      typeof token === "object" &&
      token.expires_at !== undefined &&
      token.expires_at <= time()
    );
  }
  public async getToken(url: string, data?: any): Promise<RestToken> {
    try {
      const res = await this.request("POST", url, data);
      return RestClient.parseTokenResponse(res.data);
    } catch (e) {
      console.debug(`RestClient.getToken error: ${e}`);
      throw e;
    }
  }

  private getAgent(secure: boolean): http.Agent | https.Agent {
    if (secure) {
      if (!this.httpsAgent) {
        this.httpsAgent = new https.Agent({
          keepAlive: true,
          timeout: this.options.timeout
        });
      }
      return this.httpsAgent;
    } else {
      if (!this.httpAgent) {
        this.httpAgent = new http.Agent({
          keepAlive: true,
          timeout: this.options.timeout
        });
      }
      return this.httpAgent;
    }
  }

  private request(
    method: string,
    relativeURL: string,
    data: any,
    token?: RestToken
  ): Promise<RestClientResponse> {
    const url = mergeURL(this.options.baseURL, relativeURL);
    const secure = /^https:/.test(url);
    const requester = secure ? https.request : http.request;
    const opt: any = {
      agent: this.getAgent(secure),
      method: method,
      timeout: this.options.timeout,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": this.options.agent || DEFAULT_AGENT
      }
    };
    if (typeof token === "string") {
      opt.headers["Authorization"] = `Bearer ${token}`;
    } else if (typeof token === "object" && token.access_token !== undefined) {
      opt.headers["Authorization"] = `${token.token_type || "Bearer"} ${
        token.access_token
      }`;
    }
    const postData = JSON.stringify(data);
    if (postData) {
      opt.headers["Content-Length"] = Buffer.byteLength(postData);
    }
    return new Promise<RestClientResponse>((resolve, reject) => {
      const dispatchError = (e: any) =>
        reject(
          `RestClient request error: ${
            typeof e === "string" ? e : JSON.stringify(e)
          }`
        );
      const req = requester(url, opt, (res: http.IncomingMessage) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("error", dispatchError);
        res.on("data", chunk => (body += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve({
                status: res.statusCode || 200,
                headers: res.headers,
                data: data
              });
            } catch (e) {
              dispatchError(e);
            }
          } else {
            dispatchError(`${res.statusCode} ${body}`);
          }
        });
      });
      req.on("error", dispatchError);
      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  public async subscribe(url: string, data?: any, token?: RestToken) {
    return (await this.request("SUBSCRIBE", url, data, token)).data;
  }
  public async unsubscribe(url: string, data?: any, token?: RestToken) {
    return (await this.request("UNSUBSCRIBE", url, data, token)).data;
  }
  public async get(url: string, token?: RestToken) {
    return (await this.request("GET", url, undefined, token)).data;
  }
  public async post(url: string, data?: any, token?: RestToken | string) {
    return (await this.request("POST", url, data, token)).data;
  }
  public async put(url: string, data?: any, token?: RestToken | string) {
    return (await this.request("PUT", url, data, token)).data;
  }
  public async patch(url: string, data?: any, token?: RestToken | string) {
    return (await this.request("PATCH", url, data, token)).data;
  }
}
