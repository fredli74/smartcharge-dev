export enum ProviderType {
  vehicle = "vehicle",
  location = "location"
}

export interface IProvider {
  name: string;
  display: string;
  version: string;
  type: ProviderType;
}
