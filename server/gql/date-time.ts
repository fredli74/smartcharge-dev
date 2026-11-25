/**
 * @file GraphQL date scalar for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import { GraphQLScalarType } from "graphql";
import { GraphQLDateTimeISO } from "graphql-scalars";

// type-graphql 2 names its ISO date scalar DateTimeISO, but clients (installed PWAs, the worker) declare their
// variables as DateTime, so the schema keeps that name.
export const GraphQLISODateTime = new GraphQLScalarType({ ...GraphQLDateTimeISO.toConfig(), name: "DateTime" });
