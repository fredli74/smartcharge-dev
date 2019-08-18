import { IProvider } from "..";

export interface NordpoolProviderData {
  provider: "nordpool";
  currency: string; // currency used for price points
}

const provider: IProvider = {
  name: "nordpool",
  display: "nordpool",
  version: "1.0",
  type: "location"
};

export default provider;
