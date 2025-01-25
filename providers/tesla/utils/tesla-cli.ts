#!/usr/bin/env node

/**
 * @file TeslaAPI agent command line utility
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */

/***
 *      ______ _______ _______ _____  ______ _______ ______ 
 *     |_____/ |______    |      |   |_____/ |______ |     \
 *     |    \_ |______    |    __|__ |    \_ |______ |_____/
 *                                                          
 






import { Command } from "commander";
import * as inquirer from "inquirer";
import { TeslaAgent, teslaAPI } from "../tesla-agent";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { IRestToken } from "@shared/restclient.js";

const tokenFileName = ".teslatoken";
const tokenFilePath = path.join(os.homedir(), tokenFileName);

function loadToken(): IRestToken {
  const data = JSON.parse(fs.readFileSync(tokenFilePath).toString());
  if (
    typeof data.access_token !== "string" ||
    data.access_token.length !== 64 ||
    typeof data.refresh_token !== "string" ||
    data.refresh_token.length !== 64 ||
    typeof data.token_type !== "string"
  ) {
    throw "Invalid token file";
  }
  return {
    access_token: data.access_token,
    token_type: data.token_type,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at
  };
}
function saveToken(token: IRestToken) {
  fs.writeFileSync(tokenFilePath, JSON.stringify(token), { mode: 0o600 });
}

async function updateToken(token: IRestToken): Promise<IRestToken> {
  const newToken = await TeslaAgent.maintainToken(token);
  if (newToken) {
    saveToken(newToken);
    return newToken;
  } else {
    return token;
  }
}

const program = new Command();

program.version("0.0.1", "-v, --version");

program
  .command("auth")
  .description("start interactive Tesla API authentication")
  .action(async () => {
    console.log(`Enter Tesla account details`);
    try {
      const answers: any = await inquirer.prompt([
        { type: "input", name: "email" },
        { type: "password", name: "password", mask: "*" }
      ]);
      console.log(`Authenticating with TeslaAPI server`);
      const token = await TeslaAgent.authenticate(
        answers.email,
        answers.password
      );
      console.log(`Authentication successful`);
      console.debug(token);
      const confirm: any = await inquirer.prompt([
        {
          type: "confirm",
          name: "action",
          message: `Save token to ${tokenFilePath}`
        }
      ]);
      if (confirm && confirm.action === true) {
        saveToken(token);
      }
    } catch (err) {
      console.log(`Authentication failed`);
    }
  });

program
  .command("list")
  .description("list vehicles")
  .action(async () => {
    const token = await updateToken(loadToken());
    const list = (await teslaAPI.get("/api/1/vehicles", token))
      .response as any[];
    for (const n of list) {
      console.log(`ID=${n.id_s}    (${n.vin} ${n.display_name})`);
    }
  });

program
  .command("wakeup <ID>")
  .description("Wake the vehicle")
  .action(async id => {
    const token = await updateToken(loadToken());
    const data = await teslaAPI.post(
      `/api/1/vehicles/${id}/wake_up`,
      undefined,
      token
    );
    console.debug(data);
  });

program
  .command("SuC <ID>")
  .description("Nearby Super Chargers")
  .action(async id => {
    const token = await updateToken(loadToken());
    const data = await teslaAPI.get(
      `/api/1/vehicles/${id}/nearby_charging_sites`,
      token
    );
    console.log(JSON.stringify(data));
  });

program
  .command("data <ID>")
  .description("Get data for the vehicle")
  .action(async id => {
    const token = await updateToken(loadToken());
    const data = await teslaAPI.get(
      `/api/1/vehicles/${id}/vehicle_data`,
      token
    );
    console.debug(data);
  });

program.parse(process.argv);
*/
