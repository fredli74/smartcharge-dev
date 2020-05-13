import { IProvider, ProviderType } from "..";

export interface NordpoolProviderData {
  provider: "nordpool";
  currency: string; // currency used for price points
}
export interface NordpoolServiceData {}

const provider: IProvider = {
  name: "nordpool",
  display: "nordpool",
  version: "1.0",
  type: ProviderType.Location
};

export default provider;
