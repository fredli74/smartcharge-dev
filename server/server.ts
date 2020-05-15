#!/usr/bin/env node

/**
 * @file Server coordinator for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import "./env";
import { strict as assert } from "assert";

import "core-js/stable";
import "regenerator-runtime/runtime";
import history from "connect-history-api-fallback";

import http from "http";
import express from "express";
import cors from "cors";
import compression from "compression";
import path from "path";
import { log, LogLevel } from "@shared/utils";
import gqlSchema, { IContext } from "./gql/api";
import { DBInterface } from "./db-interface";
import { Logic } from "./logic";
import { Command } from "commander";

import config from "@shared/smartcharge-config";
import { ApolloServer, AuthenticationError } from "apollo-server-express";
import { DBAccount } from "./db-schema";

const APP_NAME = `smartcharge-server`;
const APP_VERSION = `1.0`;

const program = new Command();
program
  .version(`${APP_NAME} ${APP_VERSION}`, "-v, --version")
  .option("-p, --port <port>", "port to listen to")
  .option("-i, --ip <ip>", "ip to listen to")
  .action(async function() {
    async function authorize(
      auth: string | undefined
    ): Promise<DBAccount | undefined> {
      try {
        const cred = auth && auth.match(/Bearer (.{64})/i);
        if (cred) {
          return await db.lookupAccount(cred[1]);
        }
      } catch (error) {
        throw new AuthenticationError("Authorization failed");
      }
    }
    const db = new DBInterface();
    await db.init();

    const logic = new Logic(db);
    await logic.init();

    try {
      // Setup express server
      const app = express();

      // Force https on official site
      if (config.SINGLE_USER === "false") {
        app.use((req, res, next) => {
          if (
            req.headers["x-forwarded-proto"] &&
            req.headers["x-forwarded-proto"] !== "https"
          ) {
            return res.redirect(
              ["https://", req.get("Host"), req.url].join("")
            );
          }
          return next();
        });
      }

      // TODO: add express-slow-down

      // Setup middlewares
      app
        .use(cors())
        .use(compression())
        .use((req, res, next) => {
          // simple console logging
          let s = `${req.ip} ${req.method} ${req.originalUrl}`;
          let rawBody = "";
          req.on("data", chunk => (rawBody += chunk));
          req.on("end", () =>
            log(
              LogLevel.Trace,
              `${s} <= ${rawBody
                .replace(/(\\n|\\r|\\t)/g, " ")
                .replace(/\s{2,}/g, " ")}`
            )
          );
          res.on("finish", () =>
            log(
              LogLevel.Debug,
              `${s} => ${res.statusCode} ${res.statusMessage}; ${res.get(
                "Content-Length"
              ) || 0}b sent`
            )
          );
          next();
        })
        .use(express.json()) // for parsing application/json
        .use(async (req, res, next) => {
          // user authentication
          try {
            res.locals.account = await authorize(req.get("Authorization"));
            if (res.locals.account) {
              log(LogLevel.Trace, `Authorized as ${res.locals.account.name}`);
            }
          } catch (err) {
            assert(err.message !== undefined); // Only real errors expected
            res.status(401).send({ success: false, error: err.message || err });
            return;
          }
          next();
        });

      // GraphQL Server
      const apiServer = new ApolloServer({
        playground: true,
        introspection: true,
        schema: await gqlSchema(),
        context: ({ res, connection }) => {
          if (connection) {
            assert(connection.context !== undefined);
            return connection.context;
          }
          assert(res !== undefined);
          return <IContext>{
            db,
            logic,
            accountUUID:
              (res.locals.account && res.locals.account.account_uuid) ||
              undefined,
            account: res.locals.account
          };
        },
        subscriptions: {
          path: "/api/gql",
          onConnect: async (connectionParams: any, _webSocket, _context) => {
            const account = await authorize(connectionParams.Authorization);
            log(
              LogLevel.Info,
              `WS connection with ${JSON.stringify(connectionParams)}`
            );
            return <IContext>{
              db,
              logic,
              accountUUID: (account && account.account_uuid) || undefined,
              account: account
            };
          }
        }
      });
      apiServer.applyMiddleware({ app, path: "/api/gql" });

      app
        .use(express.static(path.resolve(__dirname, "../app")))
        .use(
          history({
            index: "/index.html"
          })
        )
        .use(express.static(path.resolve(__dirname, "../app")));

      // Add 404 handling
      app.use(function(req, res, _next) {
        res
          .status(404)
          .send(
            `<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><title>Error 404</title></head><body><pre>You're lost, there is no ${req.url} here!</pre></body></html>`
          );
      });

      const httpServer = http.createServer(app);
      apiServer.installSubscriptionHandlers(httpServer);

      const PORT = Number(program.port || config.SERVER_PORT);
      const IP = Number(program.ip || config.SERVER_IP);

      // Start server
      httpServer.listen(PORT, IP, () => {
        log(LogLevel.Info, `HTTP Server running on port ${PORT}`);
      });
      // const io = io.listen(httpServer);
    } catch (err) {
      log(LogLevel.Error, `Error: ${err.message}`);
      log(LogLevel.Debug, err);
      log(LogLevel.Error, `Terminating server`);
      process.exit(-1);
    }
  })
  .parse(process.argv);
