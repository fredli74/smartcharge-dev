/**
 * @file GraphQL API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

// import { strict as assert } from 'assert';

import { buildSchema } from "type-graphql";
import { DBInterface } from "@server/db-interface";
import { DBAccount } from "@server/db-schema";
import { Logic } from "@server/logic";
import "reflect-metadata";
import { AccountResolver } from "./account-resolver";
import { ProviderResolver } from "./provider-resolver";
import { VehicleResolver } from "./vehicle-resolver";
import { LocationResolver } from "./location-resolver";
import { ServiceResolver } from "./service-resolver";

export interface IContext {
  db: DBInterface;
  logic: Logic;
  accountUUID: string;
  account?: DBAccount;
}
const schema = buildSchema({
  resolvers: [
    AccountResolver,
    ProviderResolver,
    VehicleResolver,
    LocationResolver,
    ServiceResolver
  ],
  emitSchemaFile: true,
  validate: false
});
export default schema;
