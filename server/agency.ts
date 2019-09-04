#!/usr/bin/env node

/**
 * @file Agency CLI for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 * @description Agency coordinates with the server which agent jobs to run
 */
import { strict as assert } from "assert";

import { Command } from "commander";
import { log, LogLevel, delay } from "@shared/utils";
import { SCClient } from "@shared/sc-client";
import providers from "@providers/provider-agents";
import { AbstractAgent } from "@providers/provider-agent";
import WebSocket from "ws";
import { ServiceProvider } from "./gql/service-type";

const APP_NAME = `smartcharge-agency`;
const APP_VERSION = `1.0`;

export class Agency {
  public ID: string | undefined;
  public agents: { [agent: string]: AbstractAgent } = {}; // map of agent names to agent classes
  public agentJobs: { [service_uuid: string]: ServiceProvider } = {}; // map of job uuid to agent jobs
  private promiseList: Promise<any>[] = [];
  private stopped: boolean = false;
  constructor(private client: SCClient) {}
  public async init() {
    // FUTURE: subscribe to a set of agents to split load between agencies
    // each agency should have its own id
    this.ID = "internal";
  }
  public async list(accept: string[]) {
    const serviceList = await this.client.getServiceProviders(accept);
    const serviceMap: { [service_uuid: string]: ServiceProvider } = {};

    // Add new entries
    for (const j of serviceList) {
      serviceMap[j.serviceID] = j;
      if (this.agentJobs[j.serviceID] === undefined) {
        log(
          LogLevel.Info,
          `Detected new agent job ${j.serviceID} adding to ${j.providerName}`
        );
        this.agents[j.providerName].add(j);
        this.agentJobs[j.serviceID] = j;
      } else {
        // Update data from server
        this.agents[j.providerName].updateData(j);
      }
    }

    // Remove orphan entries
    for (const [i, j] of Object.entries(this.agentJobs)) {
      if (serviceMap[i] === undefined) {
        log(
          LogLevel.Info,
          `Removing agent job ${j.serviceID} from ${j.providerName}`
        );
        this.agents[j.providerName].remove(j);
        delete this.agentJobs[i];
      }
    }
  }
  public async worker() {
    const agentNames = Object.keys(this.agents);
    for (const name of agentNames) {
      this.promiseList.push(this.agents[name].worker());
    }
    const workerPromise = (async () => {
      log(LogLevel.Info, `Agency ${this.ID} worker started`);
      this.stopped = false;

      let lastList = 0;
      while (!this.stopped) {
        const now = Date.now();
        if (now > lastList + 60e3) {
          // refresh list every minute
          await this.list(agentNames);
          lastList = now;
        }
        await delay(1000);
      }
      log(LogLevel.Info, `Agency ${this.ID} worker stopped`);
    })();
    this.promiseList.push(workerPromise);
    return Promise.all(this.promiseList);
  }
  public registerAgent(agent: AbstractAgent) {
    this.agents[agent.name] = agent;
  }
  public async stop() {
    this.stopped = true;
    // FUTURE: unsubscribe to release agents to other agencies
    /* await this.restclient.unsubscribe(
      `/agency?agency_uuid=${this.ID}`,
      undefined,
      this.accessToken
    );*/
    for (const name of Object.keys(this.agents)) {
      assert(this.agents[name] !== undefined);
      assert(this.agents[name].stop !== undefined);
      this.agents[name].stop();
    }
    await Promise.all(this.promiseList);
  }
}

const program = new Command();
program
  .version(`${APP_NAME} ${APP_VERSION}`, "-v, --version")
  .arguments("<access_token> <server_url>")
  .option("-d, --daemon", "keep running while logging errors")
  .action(async (access_token, server_url) => {
    const ws_url = server_url.replace(/^http/, "ws");
    const client = new SCClient(server_url, ws_url, WebSocket);
    const agency = new Agency(client);

    for (const provider of providers) {
      if (provider.agent) {
        agency.registerAgent(provider.agent(client));
      }
    }

    process.on("SIGINT", async function() {
      log(LogLevel.Info, `Caught interrupt signal, shutting down.`);
      process.removeAllListeners("SIGINT"); // remove it to allow double ctrl-c
      try {
        await agency.stop();
      } catch (e) {
        log(LogLevel.Error, e);
      }
      process.exit();
    });

    for (;;) {
      try {
        await agency.stop();
        const token = process.env[access_token] || access_token;
        await client.loginWithAPIToken(token);
        await agency.init();
        log(LogLevel.Info, `Agency ID ${agency.ID} started`);
        await agency.worker();
      } catch (err) {
        log(LogLevel.Error, err);
        if (!program.daemon) {
          throw err;
        }
      }
      await delay(10e3);
    }
  })
  .parse(process.argv);

if (!program.args.length) program.help();
