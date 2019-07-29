/**
 * @file Agent definitions for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */
// import { strict as assert } from "assert";

import { delay, log, LogLevel } from "./utils";
import { Provider } from "./gql-types";

export interface AgentJob {
  uuid: string; // Unique agent job identifier
  data: any; // agent job data
  state?: any; // current in memory agent job state
  running: boolean; // is the agent currently running a job
  nextrun: number; // when to run next itteration
}

export abstract class AbstractAgent {
  public abstract name: string;
  public jobs: { [id: string]: AgentJob } = {};
  private stopped: boolean = false;
  private workerPromise: Promise<any> | undefined;
  abstract async work(job: AgentJob): Promise<number>;
  public async worker() {
    this.workerPromise = (async () => {
      log(LogLevel.Info, `Agent ${this.name} worker started`);
      this.stopped = false;
      while (!this.stopped) {
        const now = Date.now();
        (async () => {
          for (const [id, job] of Object.entries(this.jobs)) {
            if (!job.running && now >= job.nextrun) {
              log(
                LogLevel.Trace,
                `Agent ${this.name} calling work for ${job.uuid}`
              );
              job.running = true;
              let interval = 60;
              try {
                interval = await this.work(job);
              } catch (error) {
                log(LogLevel.Error, error);
              }
              job.nextrun = now + interval * 1000;
              job.running = false;
              this.jobs[id] = job;
            }
          }
        })();
        await delay(1000);
      }
      log(LogLevel.Info, `Agent ${this.name} worker stopped`);
    })();
    return this.workerPromise;
  }
  public add(job: Provider) {
    this.jobs[job.id] = {
      uuid: job.id,
      data: job.data,
      running: false,
      nextrun: 0
    };
  }
  public remove(job: Provider) {
    delete this.jobs[job.id];
  }
  public updateData(job: Provider) {
    this.jobs[job.id].data = job.data;
  }
  public async stop() {
    this.stopped = true;
    await Promise.all([this.workerPromise]);
  }
}
