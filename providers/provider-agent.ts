/**
 * @file Agent definitions for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProvider } from ".";
import { SCClient } from "@shared/sc-client";
import { log, LogLevel, delay } from "@shared/utils";
import { Action } from "@server/gql/vehicle-type";
import { ProviderSubject } from "@server/gql/agent-type";

export interface IProviderAgentInstantiator {
  (scClient: SCClient): AbstractAgent;
}
export interface IProviderAgent extends IProvider {
  agent?: IProviderAgentInstantiator;
}

export enum AgentAction {
  Update = "update",
  WakeUp = "wakeup",
  ClimateControl = "climate"
}

export interface AgentJob {
  subjectID: string; // Unique agent job identifier
  providerData: any; // agent job data
  state: any; // current in memory agent job state
  running: boolean; // is the agent currently running a job
  interval: number; // number of seconds between polls
  nextrun: number; // when to run next itteration
  actionQueue: Action[];
}
export interface AgentActionFunction {
  (job: AgentJob, action?: Action): Promise<boolean>;
}

export abstract class AbstractAgent {
  public abstract name: string;
  protected subjects: { [subjectID: string]: AgentJob } = {};
  protected stopped: boolean = false;
  protected workerPromise: Promise<any> | undefined;
  protected abstract newState(): any;
  constructor(protected scClient: SCClient) {}
  public adjustInterval(job: AgentJob, target: number) {
    if (target > job.interval) {
      job.interval += Math.ceil(job.interval / 2) + 1;
    } else {
      job.interval = target;
    }
    const nextrun = Date.now() + job.interval * 1000;
    job.nextrun = Math.min(job.nextrun, nextrun);
  }
  public async worker() {
    this.workerPromise = (async () => {
      log(LogLevel.Info, `Agent ${this.name} worker started`);
      this.stopped = false;

      // Handle actions
      this.scClient.subscribeActions(this.name, undefined, (action: Action) => {
        const subject = this.subjects[action.targetID];
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
      });

      while (!this.stopped) {
        const now = Date.now();
        (async () => {
          for (const [id, job] of Object.entries(this.subjects)) {
            if (!job.running) {
              job.running = true;
              job.actionQueue = job.actionQueue.sort(
                (a, b) => (a.data.nextrun || 0) - (b.data.nextrun || 0)
              );
              const action = job.actionQueue[0];
              if (action && now >= (action.data.nextrun || 0)) {
                log(
                  LogLevel.Trace,
                  `Agent ${this.name} calling ${action.action} for ${
                    job.subjectID
                  }`
                );
                try {
                  if (typeof (this as any)[action.action] === "function") {
                    const result = await (this as any)[action.action](
                      job,
                      action
                    );
                    if (result !== false) {
                      action.data.result = result;
                    }
                  } else {
                    throw new Error(
                      `Agent ${this.name} has not implemented action ${
                        action.action
                      }`
                    );
                  }
                } catch (error) {
                  action.data.error = error;
                  action.data.result = false;
                  log(LogLevel.Error, error);
                }
                if (action.data.result !== undefined) {
                  this.scClient.updateAction(action);
                } else {
                  action.data.nextrun = now + 5e3; // retry in 5s
                }
              } else if (
                (this as any)[AgentAction.Update] &&
                now >= job.nextrun
              ) {
                log(
                  LogLevel.Trace,
                  `Agent ${this.name} calling update for ${job.subjectID}`
                );
                try {
                  await (this as any)[AgentAction.Update](job);
                } catch (error) {
                  log(LogLevel.Error, error);
                }
                job.nextrun = now + job.interval * 1000;
              }
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
      state: this.newState(),
      running: false,
      interval: 5,
      nextrun: 0,
      actionQueue: []
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
