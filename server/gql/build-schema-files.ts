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
  let typeDefs = await tsGenerator.generate();

  let typeResolvers: GenerateResolversResult = {
    body: [],
    importHeader: []
  };
  const tsResolverGenerator = new TSResolverGenerator(
    mergedOptions,
    introspectResult
  );
  typeResolvers = await tsResolverGenerator.generate();

  /***** Project specific replaces *****/

  let isClass = false;
  typeDefs = typeDefs.reduce((acc, l) => {
    acc.push(
      l
        .replace(/^export interface (\S+) {/, (match: string, name: string) => {
          if (name !== "GQLQuery") {
            isClass = true;
            return `export class ${name} {`;
          }
          isClass = false;
          return match;
        })
        .replace(
          /^(\S+)(: (Array<)?(\S+?)>?;)/,
          (
            match: string,
            name: string,
            rest: string,
            _ignore: string,
            type: string
          ) => {
            if (isClass) {
              if (type.substr(0, 3) === "GQL") {
                acc.push(`@Type(() => ${type})`);
              }
              return `${name}${
                name.substr(name.length - 1) === "?" ? "" : "!"
              }${rest}`;
            }
            return match;
          }
        ) /*
      .replace(/^(\S+: GQLDateTime;)/, "@Type(() => Date)\n  $1")*/
    );
    return acc;
  }, [] as string[]);
  console.debug(typeDefs);

  /***** ************************* *****/

  let header = [
    jsDoc,
    ...typeResolvers.importHeader,
    "import 'reflect-metadata';",
    "import { Type } from 'class-transformer';"
  ];
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
