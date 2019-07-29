/**
 * @file GraphQL Client API for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2019 Fredrik Lidström
 * @license MIT (MIT)
 */

import fetch from "cross-fetch";
import gql from "graphql-tag";
import { ApolloClient } from "apollo-client";
import { InMemoryCache } from "apollo-cache-inmemory";
import { HttpLink } from "apollo-link-http";
import { onError } from "apollo-link-error";
import { ApolloLink } from "apollo-link";

import { GQL_API_PATH } from "./smartcharge-globals";
import {
  UpdatePriceInput,
  UpdateProviderInput,
  Provider,
  UpdateVehicleDataInput,
  UpdateVehicleInput,
  VehicleDebugInput,
  Vehicle,
  VehicleToJS
} from "./gql-types";
import { mergeURL } from "./utils";

export class SCClient {
  client: ApolloClient<unknown>;
  constructor(server_url: string, access_token: string) {
    this.client = new ApolloClient({
      link: ApolloLink.from([
        onError(({ graphQLErrors, networkError }) => {
          if (graphQLErrors)
            graphQLErrors.map(({ message, locations, path }) =>
              console.log(
                `[GraphQL error]: Message: ${message}, Location: ${locations}, Path: ${path}`
              )
            );
          if (networkError) console.log(`[Network error]: ${networkError}`);
        }),
        new HttpLink({
          uri: mergeURL(server_url, GQL_API_PATH),
          credentials: "same-origin",
          headers: {
            Authorization: `Bearer ${access_token}`
          },
          fetch: fetch
        })
      ]),
      cache: new InMemoryCache(),
      defaultOptions: {
        watchQuery: { fetchPolicy: "no-cache", errorPolicy: "none" },
        query: { fetchPolicy: "no-cache", errorPolicy: "none" },
        mutate: { fetchPolicy: "no-cache", errorPolicy: "none" }
      }
    });
  }
  async updatePrice(input: UpdatePriceInput): Promise<boolean> {
    const mutation = gql`
      mutation UpdatePrices($input: UpdatePriceInput!) {
        updatePrice(input: $input)
      }
    `;
    const result = await this.client.mutate({
      mutation: mutation,
      variables: { input: input }
    });
    return result.data.updatePrice;
  }
  async getProviders(accept: string[]): Promise<Provider[]> {
    const query = gql`
      query ListProviders($accept: [String!]!) {
        providers(accept: $accept) {
          id
          name
          data
        }
      }
    `;
    const result = await this.client.query({
      query: query,
      variables: { accept: accept }
    });
    return result.data.providers;
  }
  async updateProvider(input: UpdateProviderInput): Promise<boolean> {
    const mutation = gql`
      mutation UpdateProviderData($input: UpdateProviderInput!) {
        updateProviderData(input: $input) {
          id
          name
          data
        }
      }
    `;
    const result = await this.client.mutate({
      mutation: mutation,
      variables: { input: input }
    });
    return result.data.updateProviderData;
  }
  async getVehicle(vehicleUUID: string): Promise<Vehicle> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const query = gql`
      query GetVehicle($id: String!) {
        vehicle(id: $id) {
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
        }
      }
    `;
    const result = await this.client.query({
      query: query,
      variables: { id: vehicleUUID }
    });
    return VehicleToJS(result.data.vehicle);
  }
  async updateVehicle(input: UpdateVehicleInput): Promise<boolean> {
    // TODO: should be more flexible, updating just the fields you want
    const mutation = gql`
      mutation UpdateVehicle($input: UpdateVehicleInput!) {
        updateVehicle(input: $input)
      }
    `;
    const result = await this.client.mutate({
      mutation: mutation,
      variables: { input: input }
    });
    return result.data.updateVehicle;
  }
  async updateVehicleData(input: UpdateVehicleDataInput): Promise<boolean> {
    // TODO: should be more flexible, returning just the fields you want into an <any> response instead
    const mutation = gql`
      mutation UpdateVehicleData($input: UpdateVehicleDataInput!) {
        updateVehicleData(input: $input)
      }
    `;
    const result = await this.client.mutate({
      mutation: mutation,
      variables: { input: input }
    });
    return result.data.updateVehicleData;
  }
  async vehicleDebug(input: VehicleDebugInput): Promise<boolean> {
    const mutation = gql`
      mutation VehicleDebug($input: VehicleDebugInput!) {
        vehicleDebug(input: $input)
      }
    `;
    const result = await this.client.mutate({
      mutation: mutation,
      variables: { input: input }
    });
    return result.data.vehicleDebug;
  }
}
