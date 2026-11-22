// The app's own GraphQL client, signed in to the seeded account.
import { readFileSync } from "node:fs";
import { SCClient } from "../dist/shared/sc-client.js";
import * as S from "./scenario.mjs";

export async function signedInClient() {
  const client = new SCClient(S.BASE_URL);
  await client.loginWithAPIToken(S.TOKEN);
  return client;
}

// Bench Alpha as seeded; interaction specs end by asserting they left it like this.
export const SEEDED_ALPHA = readFileSync(new URL("./snapshots/api/gql.spec.mjs/vehicle-alpha.json", import.meta.url), "utf8");
