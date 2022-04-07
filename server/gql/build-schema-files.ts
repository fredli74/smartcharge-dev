#!/usr/bin/env node

/**
 * @file Simple schema build util for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import fs from "fs";
import path from "path";
import gqlSchema from "./api";
import { generateTSTypesAsString } from "graphql-schema-typescript";

const schemaFileName = path.resolve(
  __dirname,
  "../../../shared/sc-schema.graphql"
);
const typeFileName = path.resolve(__dirname, "../../../shared/sc-schema.ts");
// note: we're not exporting to .d.ts file because that makes enums const and babel did not support it
(async () => {
  try {
    const schema = await gqlSchema(schemaFileName);
    console.log(`GQL Schema file ${schemaFileName} created`);

    const content = await generateTSTypesAsString(schema, typeFileName, {
      smartTResult: true,
      smartTParent: true,
      asyncResult: true,
      strictNulls: true,
      customScalarType: { DateTime: "string" },
    });
    fs.writeFileSync(typeFileName, content, "utf-8");
    console.log(`Typescript definitions file ${typeFileName} created`);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(-1);
  }
})();
