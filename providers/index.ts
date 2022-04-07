export enum ProviderType {
  Vehicle = "vehicle",
  Location = "location",
}

export interface IProvider {
  name: string;
  display: string;
  version: string;
  type: ProviderType;
}
