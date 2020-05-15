/**
 * @file GraphQL API Service types for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { ObjectType, ID, Root, Resolver, FieldResolver } from "type-graphql";
import { GraphQLJSONObject } from "graphql-type-json";
import "reflect-metadata";
import { DBServiceProvider } from "@server/db-schema";

@ObjectType("ServiceProvider")
export class ServiceProvider extends DBServiceProvider {}

@Resolver(_of => ServiceProvider)
export class ServiceProviderTypeResolver {
  @FieldResolver(_returns => ID)
  ownerID(@Root() serviceprovider: ServiceProvider): string {
    return serviceprovider.account_uuid;
  }
  @FieldResolver(_returns => String)
  providerName(@Root() serviceprovider: ServiceProvider): string {
    return serviceprovider.provider_name;
  }
  @FieldResolver(_returns => ID)
  serviceID(@Root() serviceprovider: ServiceProvider): string {
    return serviceprovider.service_uuid;
  }
  @FieldResolver(_returns => GraphQLJSONObject)
  serviceData(@Root() serviceprovider: ServiceProvider): any {
    return serviceprovider.service_data;
  }
}
