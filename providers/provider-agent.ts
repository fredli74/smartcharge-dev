/**
 * @file Provider agent definitions for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProvider } from ".";
import { SCClient } from "@shared/sc-client";
import { log, LogLevel, delay } from "@shared/utils";
import { Action } from "@server/gql/vehicle-type";
import { ServiceProvider } from "@server/gql/service-type";

export interface IProviderAgentInstantiator {
  (scClient: SCClient): AbstractAgent;
}
export interface IProviderAgent extends IProvider {
  agent?: IProviderAgentInstantiator;
}

export enum AgentAction {
  Refresh = "refresh",
  ClimateControl = "climate"
}

export interface AgentWork {
  running: boolean; // is the agent currently running a job
  interval: number; // number of seconds between polls
  nextrun: number; // when to run next itteration
}
export interface AgentJob extends AgentWork {
  serviceID: string; // unique service identifier
  serviceData: any; // agent service data
  state: any; // current in memory agent job state
  actionQueue: Action[];
}
export interface AgentActionFunction {
  (job: AgentJob, action?: Action): Promise<boolean>;
}
export abstract class AbstractAgent {
  public abstract name: string;
  protected stopped: boolean = false;
  protected workerPromise: Promise<any> | undefined;
  protected abstract newState(): any;
  protected services: { [serviceID: string]: AgentJob } = {};
  public serviceWork?(job: AgentJob): Promise<void>;
  protected globalWorker?: AgentWork;
  public globalWork?(work: AgentWork): Promise<void>;

  constructor(protected scClient: SCClient) {}
  public adjustInterval(job: AgentWork, target: number) {
    if (target > job.interval) {
      job.interval += Math.ceil(job.interval / 2) + 1;
    } else {
      job.interval = target;
    }
    // If called from an action we need to adjust nextrun
    const nextrun = Date.now() + job.interval * 1e3;
    job.nextrun = Math.min(job.nextrun, nextrun);
  }

  private async handleActions(job: AgentJob) {
    if (
      !job.running &&
      typeof this.serviceWork === "function" &&
      job.actionQueue !== undefined
    ) {
      const now = Date.now();
      job.actionQueue = job.actionQueue.sort(
        (a, b) => (a.data.nextrun || 0) - (b.data.nextrun || 0)
      );
      const action = job.actionQueue[0];
      if (action && now >= (action.data.nextrun || 0)) {
        job.running = true;
        try {
          log(
            LogLevel.Trace,
            `Agent ${this.name} calling ${action.action} for ${job.serviceID}`
          );
          try {
            if (typeof (this as any)[action.action] === "function") {
              const result = await (this as any)[action.action](job, action);
              if (result !== false) {
                action.data.result = result;
              }
            } else {
              throw new Error(
                `Agent ${this.name} has not implemented action ${action.action}`
              );
            }
          } catch (error) {
            action.data.error = error;
            action.data.result = false;
            log(LogLevel.Error, error);
          }
          if (action.data.result !== undefined) {
            this.scClient.updateAction(action);
            action.data.nextrun = now + 120e3; // should not happen because the subscription will remove the action
          } else {
            action.data.nextrun = now + 5e3; // retry in 5s
          }
        } finally {
          job.running = false;
        }
      }
    }
  }
  private async handleWork(work: AgentWork) {
    const now = Date.now();
    if (!work.running && now >= work.nextrun) {
      work.running = true;
      try {
        if ((work as AgentJob).serviceID === undefined) {
          log(LogLevel.Trace, `Agent ${this.name} calling work`);
          await this.globalWork!(work);
        } else {
          log(
            LogLevel.Trace,
            `Agent ${this.name} calling update for ${
              (work as AgentJob).serviceID
            }`
          );
          await this.serviceWork!(work as AgentJob);
        }
      } catch (error) {
        log(LogLevel.Error, error);
      }
      work.nextrun = now + work.interval * 1e3;
      work.running = false;
    }
  }

  public async worker() {
    this.workerPromise = (async () => {
      log(LogLevel.Info, `Agent ${this.name} worker started`);
      this.stopped = false;

      // Handle action subscriptions
      if (typeof this.serviceWork === "function") {
        this.scClient.subscribeActions(
          this.name,
          undefined,
          (action: Action) => {
            const subject = this.services[action.serviceID];
            if (subject) {
              const hasAction = subject.actionQueue.findIndex(
                f => f.actionID === action.actionID
              );
              if (hasAction >= 0) {
                if (action.data.result !== undefined) {
                  subject.actionQueue.splice(hasAction, 1); // remove it
                } else {
                  subject.actionQueue[hasAction] = action; // update it
                }
              } else if (action.data.result === undefined) {
                subject.actionQueue.push(action); // add it
              }
            }
          }
        );
      }

      if (typeof this.globalWork === "function") {
        this.globalWorker = this.globalWorker || {
          interval: 5,
          nextrun: 0,
          running: false
        };
      }

      while (!this.stopped) {
        (async () => {
          if (typeof this.serviceWork === "function") {
            for (const [id, job] of Object.entries(this.services)) {
              await Promise.all([
                this.handleActions(job),
                this.handleWork(job)
              ]);
              this.services[id] = job;
            }
          }
          if (this.globalWorker && !this.globalWorker.running) {
            await this.handleWork(this.globalWorker);
          }
        })();
        await delay(1000);
      }
      log(LogLevel.Info, `Agent ${this.name} worker stopped`);
    })();
    return this.workerPromise;
  }
  public add(subject: ServiceProvider) {
    this.services[subject.serviceID] = {
      serviceID: subject.serviceID,
      serviceData: subject.serviceData,
      state: this.newState(),
      running: false,
      interval: 5,
      nextrun: 0,
      actionQueue: []
    };
  }
  public remove(subject: ServiceProvider) {
    delete this.services[subject.serviceID];
  }
  public updateData(subject: ServiceProvider) {
    this.services[subject.serviceID].serviceData = subject.serviceData;
  }
  public async stop() {
    this.stopped = true;
    await Promise.all([this.workerPromise]);
  }
}
