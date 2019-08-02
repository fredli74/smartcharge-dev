/**
 * @file Server coordinator for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */
import { strict as assert } from "assert";

import "core-js/stable";
import "regenerator-runtime/runtime";

import http from "http";
import express from "express";
import cors from "cors";
import compression from "compression";
import { log, LogLevel } from "@shared/utils";
import gqlSchema, { IContext } from "./gql-api";
import { DBInterface } from "./db-interface";
import { Logic } from "./logic";

import config from "@shared/smartcharge-config.json";
import { ApolloServer } from "apollo-server-express";
import { DBAccount } from "./db-schema";

(async function() {
  async function authorize(
    auth: string | undefined
  ): Promise<DBAccount | undefined> {
    try {
      const cred = auth && auth.match(/Bearer (.{64})/i);
      if (cred) {
        return db.lookupAccount(cred[1]);
      }
    } catch (error) {
      console.debug(error);
      throw new Error("Authorization failed");
    }
  }
  const db = new DBInterface();
  await db.init();
  const logic = new Logic(db);
  await logic.init();

  try {
    // Setup express server
    const app = express();

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
      schema: await gqlSchema,
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
        onConnect: async (connectionParams: any, webSocket, context) => {
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

    // Web server
    //	app.get('/', function (req, res) {
    //		res.sendfile('default.html', { root: __dirname + "/relative_path_of_file" });
    //	});
    //

    // Add 404 handling
    app.use(function(req, res, _next) {
      res
        .status(404)
        .send(
          `<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><title>Error 404</title></head><body><pre>You're lost, there is no ${
            req.url
          } here!</pre></body></html>`
        );
    });

    const httpServer = http.createServer(app);
    apiServer.installSubscriptionHandlers(httpServer);

    // Start server
    httpServer.listen(
      config.SERVER_LISTEN_PORT,
      config.SERVER_LISTEN_IP,
      () => {
        log(
          LogLevel.Info,
          `HTTP Server running on port ${config.SERVER_LISTEN_PORT}`
        );
      }
    );
    // const io = io.listen(httpServer);
  } catch (err) {
    log(LogLevel.Error, `Error: ${err.message}`);
    log(LogLevel.Debug, err);
    log(LogLevel.Error, `Terminating server`);
    process.exit(-1);
  }
})();
