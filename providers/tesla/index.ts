import { IProvider, ProviderType } from "..";

// tesla API token
export type TeslaToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

// client side info
export interface TeslaProviderData {
  provider: "tesla";
  vin: string;
  invalid_token?: boolean;
  auto_hvac?: boolean;
  auto_port?: boolean;
  car_type?: string;
  option_codes?: string;
  network?: any;
  telemetryData?: any;
}

// agent side info
export interface TeslaServiceData {
  token: TeslaToken; // token for API authentication
  updated?: number;
  invalid_token?: boolean;
}

export enum TeslaProviderQueries {
  Vehicles = "vehicles",
}
export enum TeslaProviderMutates {
  Authorize = "authorize",
  RefreshToken = "refreshToken",
  NewVehicle = "newVehicle",
}

const provider: IProvider = {
  name: "tesla",
  display: "Tesla",
  version: "1.0",
  type: ProviderType.Vehicle,
};

export default provider;
