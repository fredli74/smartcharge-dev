/**
 * @file Very simple http/https JSON REST client
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT-0 (MIT No Attribution)
 */

import * as https from "https";
import * as http from "http";
import * as https_proxy_agent from "https-proxy-agent";
import * as zlib from "zlib";

import { mergeURL } from "./utils";

const DEFAULT_AGENT = `RestClient/1.0 (Node.js)`;

export interface Options {
  baseURL?: string;
  headers?: http.OutgoingHttpHeaders;
  proxy?: string;
  timeout?: number;
}

export interface RestClientResponse {
  status: number;
  headers: any;
  data: any;
}

export class RestClientError extends Error {
  constructor(message: string, public code: number) {
    super(message);
    this.name = "RestClientError";
  }
}

export class RestClient {
  private httpAgent: http.Agent | undefined;
  private httpsAgent: https.Agent | undefined;
  private httpsProxyAgent: https_proxy_agent.HttpsProxyAgent | undefined;
  constructor(private options: Options) {}

  private getAgent(secure: boolean): http.Agent | https.Agent {
    if (this.options.proxy) {
      if (!this.httpsProxyAgent) {
        this.httpsProxyAgent = new https_proxy_agent.HttpsProxyAgent(
          this.options.proxy
        );
      }
      return this.httpsProxyAgent;
    } else if (secure) {
      if (!this.httpsAgent) {
        this.httpsAgent = new https.Agent({
          keepAlive: true,
          timeout: this.options.timeout,
        });
      }
      return this.httpsAgent;
    } else {
      if (!this.httpAgent) {
        this.httpAgent = new http.Agent({
          keepAlive: true,
          timeout: this.options.timeout,
        });
      }
      return this.httpAgent;
    }
  }

  private request(
    method: string,
    relativeURL: string,
    data: any,
    bearerToken?: string
  ): Promise<RestClientResponse> {
    const url = mergeURL(this.options.baseURL, relativeURL);
    const secure = /^https:/.test(url);
    const requester = secure ? https.request : http.request;
    const opt: any = {
      agent: this.getAgent(secure),
      method: method,
      timeout: this.options.timeout,
      headers: {
        ...this.options.headers,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate"
      },
    };
    if (opt.headers["User-Agent"] === undefined) {
      opt.headers["User-Agent"] = DEFAULT_AGENT;
    }
    if (typeof bearerToken === "string") {
      opt.headers[
        opt.headers["Authorization"] !== undefined
          ? "X-Forwarded-Authorization"
          : "Authorization"
      ] = `Bearer ${bearerToken}`;
    }
    const postData = JSON.stringify(data);
    if (postData) {
      opt.headers["Content-Length"] = Buffer.byteLength(postData);
    }
    return new Promise<RestClientResponse>((resolve, reject) => {
      const dispatchError = (e: any, code?: number) => {
        const s = `request error: ${code ? code + " " : ""}${
          typeof e === "string" ? e : JSON.stringify(e)
        }`;
        reject(new RestClientError(s, code || 500));
      };

      const req = requester(url, opt, (res: http.IncomingMessage) => {
        let stream: NodeJS.ReadableStream = res;

        // Handle gzip and deflate responses
        const encoding = res.headers['content-encoding'];
        if (encoding === 'gzip') {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = res.pipe(zlib.createInflate());
        }

        let body = "";
        stream.setEncoding("utf8");
        stream.on("error", (e) => {
          console.log(`RestClientError: Response error: ${e}`);
          dispatchError(e);
        });
        stream.on("data", (chunk) => (body += chunk));
        stream.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const data = JSON.parse(body);
              resolve({
                status: res.statusCode || 200,
                headers: res.headers,
                data: data,
              });
            } catch (e: any) {
              console.log(`RestClientError: Unable to parse JSON`);
              console.log(`RestClientError: ${body}`);
              dispatchError(e.message);
            }
          } else {
            console.log(`RestClientError: Non-2xx status: ${res.statusCode}`);
            console.log(`RestClientError: ${body}`);
            dispatchError(res.statusMessage, res.statusCode);
          }
        });
      });
      req.on("error", (e) => {
        console.log(`RestClientError: Request error: ${e}`);
        dispatchError(e);
      });
      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  public async subscribe(url: string, data?: any, bearerToken?: string) {
    return (await this.request("SUBSCRIBE", url, data, bearerToken)).data;
  }
  public async unsubscribe(url: string, data?: any, bearerToken?: string) {
    return (await this.request("UNSUBSCRIBE", url, data, bearerToken)).data;
  }
  public async get(url: string, bearerToken?: string) {
    return (await this.request("GET", url, undefined, bearerToken)).data;
  }
  public async post(url: string, data?: any, bearerToken?: string) {
    return (await this.request("POST", url, data, bearerToken)).data;
  }
  public async put(url: string, data?: any, bearerToken?: string) {
    return (await this.request("PUT", url, data, bearerToken)).data;
  }
  public async patch(url: string, data?: any, bearerToken?: string) {
    return (await this.request("PATCH", url, data, bearerToken)).data;
  }
}
