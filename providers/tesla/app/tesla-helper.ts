import { IRestToken } from "@shared/restclient";
import { SCClient } from "@shared/sc-client";
import eventBus from "@app/plugins/event-bus";
import { Vehicle } from "@shared/gql-types";

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
  invalid_token: boolean;
  option_codes: string;
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

export function vehicleImage(vehicle: Vehicle): string {
  let options = ["W32P", "PPMR", "SLR1"];
  if (vehicle.providerData.option_codes) {
    options = vehicle.providerData.option_codes;
  }
  const optionString = options.map(f => "$" + f).join(",");
  return `https://static-assets.tesla.com/configurator/compositor?&options=${optionString}&view=STUD_3QTR&model=m3&size=1441&bkba_opt=1&version=0.0.25`;
}
