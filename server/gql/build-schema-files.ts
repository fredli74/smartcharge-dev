#!/usr/bin/env node

/**
 * @file Simple schema build util for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import gqlSchema from "./api.js";
import { generateTSTypesAsString } from "graphql-schema-typescript";

// Simulate __dirname using import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaFileName = path.resolve(__dirname, "../../../shared/sc-schema.graphql");
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
