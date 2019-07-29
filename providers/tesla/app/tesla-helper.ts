import { IRestToken } from "@shared/restclient";
import apollo from "@app/plugins/apollo";
import eventBus from "@app/eventBus";

export interface TeslaNewListEntry {
  name: string;
  vin: string;
  id: string;
  provider_uuid: string;
  controlled: boolean;
}

export async function refreshToken(token: IRestToken): Promise<IRestToken> {
  try {
    return apollo.providerMutate("tesla", {
      mutation: "refreshToken",
      token: token
    });
  } catch {
    eventBus.$emit("WARNING", "Unable to verify Tesla API token");
  }
  return token;
}
