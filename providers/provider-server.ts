/**
 * @file Provider server definitions for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProvider } from ".";
import type { IContext } from "@server/gql/api.js";

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
