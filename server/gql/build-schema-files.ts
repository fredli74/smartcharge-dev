#!/usr/bin/env node

/**
 * @file Simple schema build util for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import gqlSchema from "./api";
import path from "path";
import fs from "fs";
import { GraphQLSchema } from "graphql";

import {
  GenerateTypescriptOptions,
  defaultOptions
} from "graphql-schema-typescript/lib/types";
import {
  TSResolverGenerator,
  GenerateResolversResult
} from "graphql-schema-typescript/lib/typescriptResolverGenerator";
import { TypeScriptGenerator } from "graphql-schema-typescript/lib/typescriptGenerator";
import {
  formatTabSpace,
  introspectSchema
} from "graphql-schema-typescript/lib/utils";

const schemaFileName = path.resolve(
  __dirname,
  "../../../shared/sc-schema.graphql"
);
const typeFileName = path.resolve(__dirname, "../../../shared/sc-schema.ts");
// note: we're not exporting to .d.ts file because that makes enums const and babel did not support it

const jsDoc = `/**
 * This file is auto-generated
 * Please note that any changes in this file may be overwritten
 */
 
`;

const typeDefsDecoration = [
  "",
  "/*******************************",
  " *          TYPE DEFS          *",
  " *******************************/"
];

const typeResolversDecoration = [
  "",
  "/*********************************",
  " *         TYPE RESOLVERS        *",
  " *********************************/"
];

const generateTSTypesAsString = async (
  schema: GraphQLSchema,
  outputPath: string,
  options: GenerateTypescriptOptions
): Promise<string> => {
  const mergedOptions = { ...defaultOptions, ...options };
  const introspectResult = await introspectSchema(schema);
  const tsGenerator = new TypeScriptGenerator(
    mergedOptions,
    introspectResult,
    outputPath
  );
  const typeDefs = await tsGenerator.generate();

  let typeResolvers: GenerateResolversResult = {
    body: [],
    importHeader: []
  };
  const tsResolverGenerator = new TSResolverGenerator(
    mergedOptions,
    introspectResult
  );
  typeResolvers = await tsResolverGenerator.generate();

  let header = [jsDoc, ...typeResolvers.importHeader];
  let body: string[] = [
    ...typeDefsDecoration,
    ...typeDefs,
    ...typeResolversDecoration,
    ...typeResolvers.body
  ];

  if (mergedOptions.namespace) {
    body = [
      // if namespace is under global, it doesn't need to be declared again
      `${mergedOptions.global ? "" : "declare "}namespace ${
        options.namespace
      } {`,
      ...body,
      "}"
    ];
  }

  if (mergedOptions.global) {
    body = ["export { };", "", "declare global {", ...body, "}"];
  }

  const formatted = formatTabSpace(
    [...header, ...body],
    mergedOptions.tabSpaces!
  );
  return formatted.join("\n");
};

(async () => {
  try {
    const schema = await gqlSchema(schemaFileName);
    console.log(`GQL Schema file ${schemaFileName} created`);

    const content = await generateTSTypesAsString(schema, typeFileName, {
      smartTResult: true,
      smartTParent: true,
      asyncResult: true,
      customScalarType: { DateTime: "Date" }
    });
    fs.writeFileSync(typeFileName, content, "utf-8");
    console.log(`Typescript definitions file ${typeFileName} created`);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(-1);
  }
})();
