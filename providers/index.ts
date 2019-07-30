export type ProviderType = "vehicle" | "location";

export interface IProvider {
  name: string;
  display: string;
  version: string;
  type: ProviderType;
}
