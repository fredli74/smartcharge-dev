/**
 * @file Smart charge client for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2020 Fredrik Lidström
 * @license MIT (MIT)
 */

import { gql, InMemoryCache } from "apollo-boost";
import ApolloClient from "apollo-client";
import { mergeURL, log, LogLevel } from "@shared/utils";

import fetch from "cross-fetch";

import { ApolloLink } from "apollo-link";
import { WebSocketLink } from "apollo-link-ws";
import { onError } from "apollo-link-error";
import { setContext } from "apollo-link-context";
import { HttpLink } from "apollo-link-http";
import { SubscriptionClient } from "subscriptions-transport-ws";
import {
  GQLAccount,
  GQLLocation,
  GQLUpdateLocationInput,
  GQLUpdatePriceInput,
  GQLVehicle,
  GQLUpdateVehicleInput,
  GQLUpdateVehicleDataInput,
  GQLVehicleDebugInput,
  GQLServiceProvider,
  GQLAction
} from "./sc-schema";
import { API_PATH } from "./smartcharge-defines";

export class SCClient extends ApolloClient<any> {
  public account?: GQLAccount;
  private token?: string;
  private wsClient?: SubscriptionClient;
  constructor(
    server_url: string,
    subscription_url?: string,
    webSocketImpl?: any
  ) {
    const errorLink = onError(({ graphQLErrors, networkError }) => {
      if (graphQLErrors) {
        graphQLErrors.map(({ message, locations, path }) => {
          console.log(
            `[GraphQL error]: Message: ${message}, Location: ${locations}, Path: ${path}`
          );
          if (message === "Unauthorized") {
            this.logout();
          }
        });
      }
      if (networkError) {
        if (
          this.token &&
          (networkError.message === "Authorization failed" ||
            (networkError as any).statusCode === 401)
        ) {
          this.logout();
        }
        console.log(`[Network error]: ${networkError}`);
      }
    });
    const httpLink = ApolloLink.from([
      setContext((_, { headers }) => {
        return {
          headers: this.token
            ? {
                ...headers,
                authorization: `Bearer ${this.token}`
              }
            : headers
        };
      }),
      new HttpLink({
        // You should use an absolute URL here
        uri: mergeURL(server_url, API_PATH),
        fetch: fetch
      })
    ]);

    if (subscription_url) {
      const wsClient = new SubscriptionClient(
        mergeURL(subscription_url, API_PATH),
        {
          connectionParams: () => {
            return this.token ? { Authorization: `Bearer ${this.token}` } : {};
          },
          reconnect: true
        },
        webSocketImpl
      );

      super({
        connectToDevTools: true,
        link: errorLink.concat(new WebSocketLink(wsClient)),
        cache: new InMemoryCache()
      });
      this.wsClient = wsClient;
    } else {
      super({
        connectToDevTools: true,
        link: errorLink.concat(httpLink),
        cache: new InMemoryCache()
      });
    }

    this.defaultOptions = {
      watchQuery: { fetchPolicy: "no-cache", errorPolicy: "none" },
      query: { fetchPolicy: "no-cache", errorPolicy: "none" },
      mutate: { fetchPolicy: "no-cache", errorPolicy: "none" }
    };
  }

  static accountFragment = `id name token`;
  public async loginWithPassword(password: string) {
    this.account = (
      await this.mutate({
        mutation: gql`
          mutation LoginWithPassword($password: String!) {
              loginWithPassword(password: $password) { ${SCClient.accountFragment} }
          }`,
        variables: { password }
      })
    ).data.loginWithPassword;
    this.token = this.account!.token;
    localStorage.setItem("token", this.account!.token);
    if (this.wsClient) {
      this.wsClient.close(false, true);
    }
  }
  public async loginWithAPIToken(token: string) {
    this.token = token;
    this.account = (
      await this.query({
        query: gql`{ account { ${SCClient.accountFragment} } }`
      })
    ).data.account;
  }
  public async loginWithIDToken(idToken: string) {
    this.account = (
      await this.mutate({
        mutation: gql`
      mutation LoginWithIDToken($idToken: String!) {
        loginWithIDToken(idToken: $idToken) { ${SCClient.accountFragment} }
          }`,
        variables: { idToken }
      })
    ).data.loginWithIDToken;
    this.token = this.account!.token;
    localStorage.setItem("token", this.account!.token);
    if (this.wsClient) {
      this.wsClient.close(false, true);
    }
  }

  public get authorized() {
    return Boolean(this.account);
  }
  public async logout() {
    localStorage.removeItem("token");
    this.token = undefined;
    this.account = undefined;
    this.cache.reset();
    if (this.wsClient) {
      this.wsClient.close(false, true);
    }
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
  serviceID
  providerData
  priceList {
    id
    ownerID
    name
    isPrivate
  }`;

  public async getLocation(locationUUID: string): Promise<GQLLocation> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const query = gql`query GetLocation($id: String!) { location(id: $id) { ${SCClient.locationFragment} } }`;
    const result = await this.query({
      query,
      variables: { id: locationUUID }
    });
    return result.data.location;
  }
  public async getLocations(): Promise<GQLLocation[]> {
    const query = gql`query GetLocations { locations { ${SCClient.locationFragment} } }`;
    const result = await this.query({ query });
    return result.data.locations as GQLLocation[];
  }
  public async updateLocation(input: GQLUpdateLocationInput): Promise<boolean> {
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
  public async updatePrice(input: GQLUpdatePriceInput): Promise<boolean> {
    const mutation = gql`
      mutation UpdatePrices($input: UpdatePriceInput!) {
        _updatePrice(input: $input)
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data._updatePrice;
  }

  static vehicleFragment = `
  id
  ownerID
  serviceID
  name
  maximumLevel
  schedule {
    type
    level
    time
  }
  providerData
  geoLocation {
    latitude
    longitude
  }
  locationID
  locationSettings {
    locationID
    directLevel
    goal
  }
  batteryLevel
  odometer
  outsideTemperature
  insideTemperature
  climateControl
  isConnected
  chargingTo
  estimatedTimeLeft
  isDriving
  status
  smartStatus
  chargePlan {
    chargeType
    chargeStart
    chargeStop
    level
    comment
  }
  updated`;

  public async getVehicle(vehicleUUID: string): Promise<GQLVehicle> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const query = gql`query GetVehicle($id: String!) { vehicle(id: $id) { ${SCClient.vehicleFragment} } }`;
    const result = await this.query({
      query,
      variables: { id: vehicleUUID }
    });
    return result.data.vehicle;
  }
  public async getVehicles(): Promise<GQLVehicle[]> {
    const query = gql`query GetVehicles { vehicles { ${SCClient.vehicleFragment} } }`;
    const result = await this.query({ query });
    return (result.data.vehicles as GQLVehicle[]).map(v => v);
  }
  public async updateVehicle(input: GQLUpdateVehicleInput): Promise<boolean> {
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
    input: GQLUpdateVehicleDataInput
  ): Promise<boolean> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const mutation = gql`
      mutation UpdateVehicleData($input: UpdateVehicleDataInput!) {
        _updateVehicleData(input: $input)
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data._updateVehicleData;
  }
  public async vehicleDebug(input: GQLVehicleDebugInput): Promise<boolean> {
    const mutation = gql`
      mutation VehicleDebug($input: VehicleDebugInput!) {
        _vehicleDebug(input: $input)
      }
    `;
    const result = await this.mutate({
      mutation: mutation,
      variables: { input }
    });
    return result.data._vehicleDebug;
  }

  public async getServiceProviders(
    accept: string[]
  ): Promise<GQLServiceProvider[]> {
    if (accept.length <= 0) {
      return [];
    }
    const query = gql`
      query ServiceProviders($accept: [String!]!) {
        _serviceProviders(accept: $accept) {
          ownerID
          providerName
          serviceID
          serviceData
        }
      }
    `;
    const result = await this.query({
      query,
      variables: { accept }
    });
    return result.data._serviceProviders;
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
  private async actionMutation(
    actionID: number | undefined,
    serviceID: string,
    action: string,
    data?: any
  ) {
    const mutation = gql`
      mutation PerformAction(
        $actionID: Int
        $serviceID: ID!
        $action: String!
        $data: JSONObject
      ) {
        performAction(
          actionID: $actionID
          serviceID: $serviceID
          action: $action
          data: $data
        )
      }
    `;

    const result = await this.mutate({
      mutation,
      variables: { actionID, serviceID, action, data }
    });
    return result.data.performAction;
  }

  public async action(
    serviceID: string,
    action: string,
    data?: any
  ): Promise<GQLAction> {
    return this.actionMutation(undefined, serviceID, action, data);
  }
  public async updateAction(action: GQLAction) {
    return this.actionMutation(
      action.actionID,
      action.serviceID,
      action.action,
      action.data
    );
  }

  public subscribeActions(
    providerName: string | undefined,
    serviceID: string | undefined,
    callback: (action: GQLAction) => any
  ) {
    const query = gql`
      subscription ActionSubscription($providerName: String, $serviceID: ID) {
        actionSubscription(providerName: $providerName, serviceID: $serviceID) {
          actionID
          serviceID
          providerName
          action
          data
        }
      }
    `;
    const result = this.subscribe({
      query,
      variables: { providerName, serviceID }
    });
    result.subscribe({
      next(value: any) {
        const action = value.data.actionSubscription;
        callback(action);
      },
      error(err) {
        log(LogLevel.Error, err);
        throw new Error(err);
      }
    });
  }

  public async chargeCalibration(
    vehicleID: string,
    level: number | undefined,
    duration: number | undefined,
    powerUse: number | undefined
  ) {
    const mutation = gql`
      mutation ChargeCalibration(
        $vehicleID: ID!
        $level: Int
        $duration: Int
        $powerUse: Float
      ) {
        _chargeCalibration(
          vehicleID: $vehicleID
          level: $level
          duration: $duration
          powerUse: $powerUse
        )
      }
    `;

    const result = await this.mutate({
      mutation,
      variables: { vehicleID, level, duration, powerUse }
    });
    return result.data._chargeCalibration;
  }

  public async removeVehicle(id: string, confirm: string): Promise<void> {
    const mutation = gql`
      mutation RemoveVehicle($id: String!, $confirm: String!) {
        removeVehicle(id: $id, confirm: $confirm)
      }
    `;
    await this.mutate({
      mutation: mutation,
      variables: { id, confirm }
    });
  }

  public async removeLocation(id: string, confirm: string): Promise<void> {
    const mutation = gql`
      mutation RemoveLocation($id: String!, $confirm: String!) {
        removeLocation(id: $id, confirm: $confirm)
      }
    `;
    await this.mutate({
      mutation: mutation,
      variables: { id, confirm }
    });
  }
}
