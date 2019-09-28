import { IProvider, ProviderType } from "..";
import { IRestToken } from "@shared/restclient";

// client side info
export interface TeslaProviderData {
  provider: "tesla";
  vin: string;
  invalid_token?: boolean;
  auto_hvac?: boolean;
  auto_port?: boolean;
  car_type?: string;
  option_codes?: string;
}

// agent side info
export interface TeslaServiceData {
  token: IRestToken; // token for API authentication
  updated?: number;
  invalid_token?: boolean;
}

export enum TeslaProviderQueries {
  Vehicles = "vehicles"
}
export enum TeslaProviderMutates {
  RefreshToken = "refreshToken",
  NewVehicle = "newVehicle"
}

const provider: IProvider = {
  name: "tesla",
  display: "Tesla",
  version: "1.0",
  type: ProviderType.vehicle
};

export default provider;
