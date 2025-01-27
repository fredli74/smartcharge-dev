#!/usr/bin/env node

/**
 * @file Server coordinator for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

import "./env.js";
import { strict as assert } from "assert";

import history from "connect-history-api-fallback";

import http from "http";
import express, { RequestHandler } from "express";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import path from "path";
import { log, LogLevel } from "@shared/utils.js";
import gqlSchema from "./gql/api.js";
import type { IContext } from "./gql/api.js";
import { DBInterface } from "./db-interface.js";
import { Logic } from "./logic.js";
import { Command } from "commander";

import config from "@shared/smartcharge-config.js";
import { ApolloServer } from "@apollo/server"
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import { DBAccount } from "./db-schema.js";
import { GraphQLError } from "graphql";
import { fileURLToPath } from 'url';
import { useServer } from 'graphql-ws/lib/use/ws';
import { Context, SubscribeMessage } from "graphql-ws";
import WebSocket, { WebSocketServer } from "ws";


const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_NAME = `smartcharge-server`;
const APP_VERSION = `1.0`;

const program = new Command();
program
  .version(`${APP_NAME} ${APP_VERSION}`, "-v, --version")
  .option("-p, --port <port>", "port to listen to")
  .option("-i, --ip <ip>", "ip to listen to")
  .action(async function () {
    try {
      const db = new DBInterface();
      await db.init();

      const logic = new Logic(db);
      await logic.init();

      const authorize = async (
        auth: string | undefined
      ): Promise<DBAccount | undefined> => {
        try {
          const cred = auth && auth.match(/Bearer (.{64})/i);
          if (cred) {
            return await db.lookupAccount(cred[1]);
          }
        } catch (error) {
          throw new GraphQLError("Authorization failed", undefined, undefined, undefined, undefined, undefined,
            { code: "UNAUTHORIZED" });
        }
      };

      // Setup express server
      const app = express();
      app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);

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
        .use(
          rateLimit({
            windowMs: 15 * 60e3, // 15 min
            max: 255,
            skipSuccessfulRequests: true,
          })
        )
        .use(compression())
        .use((req, res, next) => {
          // simple console logging
          const s = `${req.ip} ${req.method} ${req.originalUrl}`;
          let rawBody = "";
          req.on("data", (chunk) => (rawBody += chunk));
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
              `${s} => ${res.statusCode} ${res.statusMessage}; ${res.get("Content-Length") || 0
              }b sent`
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
              log(LogLevel.Trace, `Authorized as ${res.locals.account.name} (${res.locals.account.account_uuid})`);
            }
          } catch (err: any) {
            assert(err.message !== undefined); // Only real errors expected
            res.status(401).send({ success: false, error: err.message || err });
            return;
          }
          next();
        });

      const contextFromAuthorization = async (auth: string | unknown): Promise<IContext> => {
        if (typeof auth === "string") {
          const account = await authorize(auth);
          if (account) {
            log(LogLevel.Debug, `Bearer authorization successful for account_uuid: ${account.account_uuid}`);
            return {
              db,
              logic,
              accountUUID: account.account_uuid,
              account: account,
            };
          }
        }
        return {
          db,
          logic,
        };
      };

      const httpServer = http.createServer(app);

      // GraphQL Socket and Http Server
      const schema = await gqlSchema();
      const wsServer = new WebSocketServer({ server: httpServer, path: "/api/gql", WebSocket });
      const serverCleanup = useServer({
        schema,
        context: async (ctx: Context, msg: SubscribeMessage, args: any) => {
          return (ctx.extra as any).scContext;
        },
        onConnect: async (ctx: Context) => {
          const c = await contextFromAuthorization(ctx.connectionParams && ctx.connectionParams["Authorization"]);
          (ctx.extra as any).scContext = c;
          log(LogLevel.Trace, `WS ${(ctx.extra as any)?.socket?._socket?.remoteAddress} Connected - ${c.accountUUID ? `Authorized as ${c.account?.name} (${c.accountUUID})` : `Unauthorized`}`);
        },
        onDisconnect: async (ctx: Context) => {
          const c = (ctx.extra as any).scContext;
          log(LogLevel.Trace, `WS ${(ctx.extra as any)?.socket?._socket?.remoteAddress} Disconnected - ${c && c.accountUUID ? `Authorized as ${c.account?.name} (${c.accountUUID})` : `Unauthorized`}`);
        }
      }, wsServer);
      const apolloServer = new ApolloServer<IContext>({
        introspection: true,
        schema: schema,
        plugins: [
          ApolloServerPluginDrainHttpServer({ httpServer }),
          {
            async serverWillStart() {
              return {
                async drainServer() {
                  await serverCleanup.dispose();
                }
              };
            }
          },
          ApolloServerPluginLandingPageLocalDefault(),
        ],
      });
      await apolloServer.start()
      app.use(`/api/gql`,
        expressMiddleware(apolloServer, {
          context: async ({ req }): Promise<IContext> => {
            const auth = req.headers.authorization;
            return contextFromAuthorization(auth);
          }
        })
      );
      app.get("/ip", (req, res) => { res.send(req.ip); }); // ip echo endpoint
      app
        .use(express.static(path.resolve(__dirname, "../app")))
        .use(history({ index: "/index.html" }) as unknown as RequestHandler)
        .use(express.static(path.resolve(__dirname, "../app")));

      // Add 404 handling
      app.use(function (req, res, _next) {
        res
          .status(404)
          .send(
            `<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'><title>Error 404</title></head><body><pre>You're lost.</pre></body></html>`
          );
      });

      const PORT = Number(program.opts().port || config.SERVER_PORT);
      const IP = Number(program.opts().ip || config.SERVER_IP);

      // Start server
      httpServer.listen(PORT, IP, () => {
        log(LogLevel.Info, `HTTP Server running on port ${PORT}`);
      });
      // const io = io.listen(httpServer);
    } catch (err: any) {
      log(LogLevel.Error, `Error: ${err.message}`);
      log(LogLevel.Debug, err);
      log(LogLevel.Error, `Terminating server`);
      process.exit(-1);
    }
  })
  .parse(process.argv);
