#!/usr/bin / env node

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
import { AbstractAgent } from "@shared/agent";
import { TibberAgent } from "../providers/tibber/tibber_agent";
import { TeslaAgent } from "../providers/tesla/tesla-agent";

const program = new Command();

const APP_NAME = `Agency`;
const APP_VERSION = `1.0`;

import { SCClient } from "@shared/sc-client";
import { Provider } from "@shared/gql-types";

import providers from "@providers/provider-agents";

export class Agency {
  public ID: string | undefined;
  public agents: { [agent: string]: AbstractAgent } = {}; // map of agent names to agent classes
  public agentJobs: { [uuid: string]: Provider } = {}; // map of job uuid to agent jobs
  private promiseList: Promise<any>[] = [];
  private stopped: boolean = false;
  constructor(private client: SCClient) {}
  public async init() {
    // FUTURE: subscribe to a set of agents to split load between agencies
    // each agency should have its own id
    this.ID = "internal";
  }
  public async list(accept: string[]) {
    const agentList = await this.client.getProviders(accept);
    const agentMap: { [uuid: string]: Provider } = {};

    // Add new entries
    for (const j of agentList) {
      agentMap[j.id] = j;
      if (this.agentJobs[j.id] === undefined) {
        log(
          LogLevel.Info,
          `Detected new agent job ${j.id} adding to ${j.name}`
        );
        this.agents[j.name].add(j);
        this.agentJobs[j.id] = j;
      } else {
        // Update data from server
        this.agents[j.name].updateData(j);
      }
    }

    // Remove orphan entries
    for (const [i, j] of Object.entries(this.agentJobs)) {
      if (agentMap[i] === undefined) {
        log(LogLevel.Info, `Removing agent job ${j.id} from ${j.name}`);
        this.agents[j.name].remove(j);
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

program
  .version(`${APP_NAME} ${APP_VERSION}`, "-v, --version")
  .arguments("<access_token> <server_url>")
  .action(async (access_token, server_url) => {
    const client = new SCClient(server_url);
    await client.loginWithToken(access_token);

    const agency = new Agency(client);

    for (const provider of providers) {
      if (provider.agent) {
        const p = provider.agent(client);
        agency.registerAgent(provider.agent(client));
      }
    }

    agency.registerAgent(new TibberAgent(client));
    //    agency.registerAgent(new TeslaAgent(client));

    await agency.init();
    log(LogLevel.Info, `Agency ID ${agency.ID} started`);

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

    agency.worker();
  })
  .parse(process.argv);

if (!program.args.length) program.help();
