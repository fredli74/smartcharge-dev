import { IProvider } from ".";
import { AbstractAgent } from "@shared/agent";
import { SCClient } from "@shared/gql-client";

export interface IProviderAgentInstantiator {
  (scClient: SCClient): AbstractAgent;
}
export interface IProviderAgent extends IProvider {
  agent?: IProviderAgentInstantiator;
}

import Tesla from "./tesla/tesla-agent";

const providers: IProviderAgent[] = [Tesla];
export default providers;
