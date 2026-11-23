// The app's own GraphQL client, signed in to the seeded account.
import { SCClient } from "../dist/shared/sc-client.js";
import * as S from "./scenario.mjs";

export async function signedInClient() {
  const client = new SCClient(S.BASE_URL);
  await client.loginWithAPIToken(S.TOKEN);
  return client;
}

// Bench Alpha as the app sees it; interaction specs take it first and must leave it unchanged
export const alphaState = async (client) => JSON.stringify(await client.getVehicle(S.ALPHA.id));

// Bench Alpha's schedule entries of one type
export const alphaSchedule = async (client, type) => (await client.getVehicle(S.ALPHA.id)).schedule
  .filter((s) => s.type === type).map(({ level, time }) => ({ level, time }));
