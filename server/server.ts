/**
 * @file Server coordinator for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import "core-js/stable";
import "regenerator-runtime/runtime";

import http from "http";
import express from "express";
import cors from "cors";
import compression from "compression";
import { log, LogLevel } from "@shared/utils";
import { gqlServer } from "./gql-api";
import { DBInterface } from "./db-interface";
import { Logic } from "./logic";

import config from "@shared/smartcharge-config.json";

(async function() {
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
        res.locals.authorized = false;
        const auth = req.get("Authorization");
        if (auth) {
          try {
            const cred = auth.match(/Bearer (.{64})/i);
            if (cred) {
              res.locals.account = await db.lookupAccount(cred[1]);
              res.locals.authorized = true;
              log(LogLevel.Trace, `Authorized as ${res.locals.account.name}`);
            }
          } catch (_error) {
            // Any error is simply an authentication failure
          }
          if (!res.locals.authorized) {
            res
              .status(401)
              .send({ success: false, error: "Authorization failed" });
            return;
          }
        }
        next();
      });

    // GraphQL Server
    await gqlServer(app, db, logic);

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

    // Start servers
    const httpServer = http.createServer(app);
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
