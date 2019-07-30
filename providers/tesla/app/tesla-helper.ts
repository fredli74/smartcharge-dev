import { IRestToken } from "@shared/restclient";
import { SCClient } from "@shared/sc-client";
import eventBus from "@app/plugins/eventBus";

// List entry when adding a new Tesla vehicle
export interface TeslaNewListEntry {
  name: string; // name of vehicle
  id: string; // tesla id to control vehicle
  tesla_token: IRestToken; // token to access teslaAPI
  vin: string; // For UI display
  controlled: boolean; // Already controlled by smartcharge
}

// Structure of databased stored provider specific information
export interface TeslaProviderData {
  provider: "tesla";
  sid: string; // tesla vehicle id
  token: IRestToken; // token for API authentication
  invalidToken: boolean;
}

// Helper function to refresh token (through the server proxy) and at the
// same time update the database
export async function refreshToken(
  client: SCClient,
  token: IRestToken
): Promise<IRestToken> {
  try {
    return client.providerMutate("tesla", {
      mutation: "refreshToken",
      token: token
    });
  } catch {
    // TODO: this should not be here, it should be wrappen in the tesla-app
    eventBus.$emit("ALERT_WARNING", "Unable to verify Tesla API token");
  }
  return token;
}
