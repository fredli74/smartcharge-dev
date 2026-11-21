// GraphQL contract: the app's own client against the seeded server, compared with saved responses.
import { test, expect } from "@playwright/test";
import { signedInClient } from "./client.mjs";
import * as S from "./scenario.mjs";

let client;
test.beforeAll(async () => {
  client = await signedInClient();
});
const matches = (data, name) => expect(`${JSON.stringify(data, null, 2)}\n`).toMatchSnapshot(`${name}.json`);

test("account", async () => matches(client.account, "account"));
test("vehicles", async () => matches(await client.getVehicles(), "vehicles"));
test("vehicle", async () => matches(await client.getVehicle(S.ALPHA.id), "vehicle-alpha"));
test("locations", async () => matches(await client.getLocations(), "locations"));
test("price lists", async () => matches(await client.getPriceLists(), "price-lists"));
test("price list", async () => matches(await client.getPriceList(S.PRICE_LIST_ID), "price-list"));
