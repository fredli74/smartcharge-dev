// The app's own GraphQL client, signed in to the seeded account.
import { SCClient } from "../dist/shared/sc-client.js";
import * as S from "./scenario.mjs";

export async function signedInClient() {
  const client = new SCClient(S.BASE_URL);
  await client.loginWithAPIToken(S.TOKEN);
  return client;
}
