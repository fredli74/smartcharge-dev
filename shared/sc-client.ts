import ApolloClient, { gql } from "apollo-boost";
import { mergeURL } from "@shared/utils";
import { GQL_API_PATH } from "@shared/smartcharge-globals";

import fetch from "cross-fetch";

import {
  Account,
  UpdatePriceInput,
  Vehicle,
  UpdateVehicleDataInput,
  VehicleDebugInput,
  UpdateVehicleInput,
  VehicleToJS,
  NewVehicleInput,
  ProviderSubject,
  NewLocationInput,
  UpdateLocationInput
} from "@shared/gql-types";

export class SCClient extends ApolloClient<any> {
  public account?: Account;
  private token?: string;
  constructor(server_url: string) {
    super({
      uri: mergeURL(server_url, GQL_API_PATH),
      fetch: fetch,
      request: operation => {
        operation.setContext({
          headers: this.token ? { authorization: `Bearer ${this.token}` } : {}
        });
      },
      onError: ({ graphQLErrors, networkError }) => {
        if (graphQLErrors) {
          graphQLErrors.map(({ message, locations, path }) => {
            console.log(
              `[GraphQL error]: Message: ${message}, Location: ${locations}, Path: ${path}`
            );
            if (message === "Unauthorized") {
              debugger;
              this.logout();
            }
          });
        }
        if (networkError) {
          if (this.token && (networkError as any).statusCode === 401) {
            this.logout();
          }
          console.log(`[Network error]: ${networkError}`);
        }
      }
    });

    this.defaultOptions = {
      watchQuery: { fetchPolicy: "no-cache", errorPolicy: "none" },
      query: { fetchPolicy: "no-cache", errorPolicy: "none" },
      mutate: { fetchPolicy: "no-cache", errorPolicy: "none" }
    };
  }

  static accountFragment = `id name token`;
  public async loginWithPassword(password: string) {
    this.account = (await this.mutate({
      mutation: gql`
          mutation LoginWithPassword($password: String!) {
              loginWithPassword(password: $password) { ${
                SCClient.accountFragment
              } }
          }`,
      variables: { password }
    })).data.loginWithPassword;
    this.token = this.account!.token;
    localStorage.setItem("token", this.account!.token);
  }
  public async loginWithToken(token: string) {
    this.token = token;
    this.account = (await this.query({
      query: gql`{ account { ${SCClient.accountFragment} } }`
    })).data.account;
  }
  public get authorized() {
    return Boolean(this.account);
  }
  public async logout() {
    localStorage.removeItem("token");
    this.token = undefined;
    this.account = undefined;
    this.cache.reset();
  }

  static locationFragment = `
  id
  ownerID
  name
  geoLocation {
    latitude
    longitude
  }
  geoFenceRadius
  providerData`;

  public async newLocation(input: NewLocationInput): Promise<Location> {
    const mutation = gql`
      mutation NewLocation($input: NewLocationInput!) {
        newLocation(input: $input) { ${SCClient.locationFragment} }
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data.newLocation;
  }
  public async getLocation(LocationUUID: string): Promise<Location> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const query = gql`query GetLocation($id: String!) { Location(id: $id) { ${
      SCClient.locationFragment
    } } }`;
    const result = await this.query({
      query,
      variables: { id: LocationUUID }
    });
    return result.data.Location;
  }
  public async getLocations(): Promise<Location[]> {
    const query = gql`query GetLocations { Locations { ${
      SCClient.locationFragment
    } } }`;
    const result = await this.query({ query });
    return result.data.Locations as Location[];
  }
  public async updateLocation(input: UpdateLocationInput): Promise<boolean> {
    const mutation = gql`
      mutation UpdateLocation($input: UpdateLocationInput!) {
        updateLocation(input: $input) { ${SCClient.locationFragment}}
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data.updateLocation;
  }
  public async updatePrice(input: UpdatePriceInput): Promise<boolean> {
    const mutation = gql`
      mutation UpdatePrices($input: UpdatePriceInput!) {
        updatePrice(input: $input)
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data.updatePrice;
  }

  static vehicleFragment = `
  id
  name
  minimumLevel
  maximumLevel
  tripSchedule {
    level
    time
  }
  pausedUntil
  geoLocation {
    latitude
    longitude
  }
  location
  batteryLevel
  odometer
  outsideTemperature
  insideTemperature
  climateControl
  isDriving
  isConnected
  chargePlan {
    chargeStart
    chargeStop
    level
    comment
  }
  chargingTo
  estimatedTimeLeft
  status
  smartStatus
  updated
  providerData`;

  public async newVehicle(input: NewVehicleInput): Promise<Vehicle> {
    const mutation = gql`
      mutation NewVehicle($input: NewVehicleInput!) {
        newVehicle(input: $input) { ${SCClient.vehicleFragment} }
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data.newVehicle;
  }
  public async getVehicle(vehicleUUID: string): Promise<Vehicle> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const query = gql`query GetVehicle($id: String!) { vehicle(id: $id) { ${
      SCClient.vehicleFragment
    } } }`;
    const result = await this.query({
      query,
      variables: { id: vehicleUUID }
    });
    return VehicleToJS(result.data.vehicle);
  }
  public async getVehicles(): Promise<Vehicle[]> {
    const query = gql`query GetVehicles { vehicles { ${
      SCClient.vehicleFragment
    } } }`;
    const result = await this.query({ query });
    return (result.data.vehicles as Vehicle[]).map(v => VehicleToJS(v));
  }
  public async updateVehicle(input: UpdateVehicleInput): Promise<boolean> {
    const mutation = gql`
      mutation UpdateVehicle($input: UpdateVehicleInput!) {
        updateVehicle(input: $input) { ${SCClient.vehicleFragment}}
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data.updateVehicle;
  }
  public async updateVehicleData(
    input: UpdateVehicleDataInput
  ): Promise<boolean> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const mutation = gql`
      mutation UpdateVehicleData($input: UpdateVehicleDataInput!) {
        updateVehicleData(input: $input)
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data.updateVehicleData;
  }
  public async vehicleDebug(input: VehicleDebugInput): Promise<boolean> {
    const mutation = gql`
      mutation VehicleDebug($input: VehicleDebugInput!) {
        vehicleDebug(input: $input)
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data.vehicleDebug;
  }

  public async getProviderSubjects(
    accept: string[]
  ): Promise<ProviderSubject[]> {
    const query = gql`
      query ProviderSubjects($accept: [String!]!) {
        providerSubjects(accept: $accept) {
          subjectID
          ownerID
          providerType
          providerName
          providerData
        }
      }
    `;
    const result = await this.query({
      query,
      variables: { accept }
    });
    return result.data.providerSubjects;
  }

  public async providerQuery(name: string, input: any): Promise<any> {
    const query = gql`
      query ProviderQuery($name: String!, $input: JSONObject!) {
        providerQuery(name: $name, input: $input)
      }
    `;
    const result = await this.query({
      query,
      variables: { name, input }
    });
    return result.data.providerQuery.result;
  }
  public async providerMutate(name: string, input: any): Promise<any> {
    const mutation = gql`
      mutation ProviderMutate($name: String!, $input: JSONObject!) {
        providerMutate(name: $name, input: $input)
      }
    `;
    const result = await this.mutate({
      mutation,
      variables: { name, input }
    });
    return result.data.providerMutate.result;
  }
}
