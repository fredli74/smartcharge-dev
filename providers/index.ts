export type ProviderType = "vehicle" | "location";

export interface IProvider {
  name: string;
  version: string;
  type: ProviderType;
}
