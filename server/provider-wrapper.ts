/**
 * @file Provider API wrapper for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import { DBInterface } from "./db-interface";
import { Logic } from "./logic";

import express from "express";
import providers from "@providers/provider-servers";

export function providerServer(db: DBInterface, logic: Logic): express.Router {
  const router = express.Router();
  for (const provider of providers) {
    if (provider.server) {
      router.use(`/${provider.name.toLowerCase()}`, provider.server(db, logic));
    }
  }
  return router;
}
