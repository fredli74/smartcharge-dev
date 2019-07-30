/**
 * @file Agent definitions for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProvider } from ".";
import { SCClient } from "@shared/sc-client";
import { log, LogLevel, delay } from "@shared/utils";
import { ProviderSubject } from "@shared/gql-types";

export interface IProviderAgentInstantiator {
  (scClient: SCClient): AbstractAgent;
}
export interface IProviderAgent extends IProvider {
  agent?: IProviderAgentInstantiator;
}

export interface AgentJob {
  subjectID: string; // Unique agent job identifier
  providerData: any; // agent job data
  state?: any; // current in memory agent job state
  running: boolean; // is the agent currently running a job
  nextrun: number; // when to run next itteration
}
export abstract class AbstractAgent {
  public abstract name: string;
  public subjects: { [subjectID: string]: AgentJob } = {};
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
          for (const [id, job] of Object.entries(this.subjects)) {
            if (!job.running && now >= job.nextrun) {
              log(
                LogLevel.Trace,
                `Agent ${this.name} calling work for ${job.subjectID}`
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
              this.subjects[id] = job;
            }
          }
        })();
        await delay(1000);
      }
      log(LogLevel.Info, `Agent ${this.name} worker stopped`);
    })();
    return this.workerPromise;
  }
  public add(subject: ProviderSubject) {
    this.subjects[subject.subjectID] = {
      subjectID: subject.subjectID,
      providerData: subject.providerData,
      running: false,
      nextrun: 0
    };
  }
  public remove(subject: ProviderSubject) {
    delete this.subjects[subject.subjectID];
  }
  public updateData(subject: ProviderSubject) {
    this.subjects[subject.subjectID].providerData = subject.providerData;
  }
  public async stop() {
    this.stopped = true;
    await Promise.all([this.workerPromise]);
  }
}
