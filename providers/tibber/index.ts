import { IProvider } from "..";

export interface TibberProviderData {
  provider: "tibber";
  home: string; // tibber home id
  currency: string; // currency used for price points
  token: string; // token for API authentication
  invalidToken: boolean;
}

const provider: IProvider = {
  name: "tibber",
  display: "Tibber",
  version: "1.0",
  type: "location"
};

export default provider;
