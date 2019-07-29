import { IProvider } from ".";
import { IContext } from "server/gql-api";

export interface IProviderServerQuery {
  (data: any, context: IContext): any;
}
export interface IProviderServerMutation {
  (data: any, context: IContext): any;
}
export interface IProviderServer extends IProvider {
  query?: IProviderServerQuery;
  mutation?: IProviderServerMutation;
}

import Tesla from "./tesla/tesla-server";

const providers: IProviderServer[] = [Tesla];
export default providers;
