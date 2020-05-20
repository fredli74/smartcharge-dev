/**
 * This file is auto-generated
 * Please note that any changes in this file may be overwritten
 */
 

/* tslint:disable */
/* eslint-disable */
import { GraphQLResolveInfo, GraphQLScalarType } from 'graphql';
/*******************************
 *          TYPE DEFS          *
 *******************************/
export interface GQLQuery {
  account: GQLAccount;
  priceLists: Array<GQLPriceList>;
  priceList: GQLPriceList;
  locations: Array<GQLLocation>;
  location: GQLLocation;
  providerQuery: GQLJSONObject;
  _serviceProviders: Array<GQLServiceProvider>;
  chartData: GQLChartData;
  vehicles: Array<GQLVehicle>;
  vehicle: GQLVehicle;
  test: GQLResolverTest;
}

export interface GQLAccount {
  id: string;
  name: string;
  token: string;
}

export interface GQLPriceList {
  id: string;
  ownerID: string;
  name: string;
  isPrivate: boolean;
}

export interface GQLLocation {
  id: string;
  ownerID: string;
  name: string;
  geoLocation: GQLGeoLocation;
  
  /**
   * Radius in meters
   */
  geoFenceRadius?: number;
  serviceID?: string;
  providerData?: GQLJSONObject;
  priceListID?: string;
  priceList?: GQLPriceList;
}

export interface GQLGeoLocation {
  latitude: number;
  longitude: number;
}

/**
 * The `JSONObject` scalar type represents JSON objects as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf).
 */
export type GQLJSONObject = any;

export interface GQLServiceProvider {
  ownerID: string;
  providerName: string;
  serviceID: string;
  serviceData: GQLJSONObject;
}

export interface GQLChartData {
  locationID: string;
  locationName: string;
  vehicleID: string;
  batteryLevel: number;
  levelChargeTime?: number;
  thresholdPrice?: number;
  chargeCurve: GQLJSONObject;
  prices: Array<GQLPriceData>;
  chargePlan?: Array<GQLChargePlan>;
  directLevel: number;
  maximumLevel: number;
}

export interface GQLPriceData {
  
  /**
   * Price tariff start time
   */
  startAt: GQLDateTime;
  
  /**
   * Price in currency per kWh (5 decimal precision)
   */
  price: number;
}

/**
 * The javascript `Date` as string. Type represents date and time as the ISO Date string.
 */
export type GQLDateTime = Date;

export interface GQLChargePlan {
  chargeType: GQLChargeType;
  
  /**
   * time to start or null for now
   */
  chargeStart?: GQLDateTime;
  
  /**
   * time to end or null for never
   */
  chargeStop?: GQLDateTime;
  level: number;
  comment: string;
}

export enum GQLChargeType {
  Calibrate = 'Calibrate',
  Minimum = 'Minimum',
  Manual = 'Manual',
  Trip = 'Trip',
  Routine = 'Routine',
  Prefered = 'Prefered',
  Fill = 'Fill'
}

export interface GQLVehicle {
  id: string;
  ownerID: string;
  serviceID?: string;
  name: string;
  
  /**
   * maximum level to charge to unless a trip is scheduled (%)
   */
  maximumLevel: number;
  
  /**
   * schedule
   */
  schedule: Array<GQLSchedule>;
  providerData: GQLJSONObject;
  geoLocation?: GQLGeoLocation;
  
  /**
   * known location id
   */
  locationID?: string;
  
  /**
   * known location
   */
  location?: GQLLocation;
  
  /**
   * location settings
   */
  locationSettings: Array<GQLVehicleLocationSetting>;
  
  /**
   * battery level (%)
   */
  batteryLevel: number;
  
  /**
   * odometer (meters)
   */
  odometer: number;
  
  /**
   * outside temperature (celcius)
   */
  outsideTemperature: number;
  
  /**
   * inside temperature (celcius)
   */
  insideTemperature: number;
  
  /**
   * is climate control on
   */
  climateControl: boolean;
  
  /**
   * is a charger connected
   */
  isConnected: boolean;
  
  /**
   * charging to level (%)
   */
  chargingTo?: number;
  
  /**
   * estimated time to complete charge (minutes)
   */
  estimatedTimeLeft?: number;
  isDriving: boolean;
  status: string;
  smartStatus: string;
  
  /**
   * charge plan
   */
  chargePlan?: Array<GQLChargePlan>;
  updated: GQLDateTime;
}

export interface GQLSchedule {
  type: GQLSchduleType;
  
  /**
   * Battery level to reach at scheduled time (%)
   */
  level: number;
  time?: GQLDateTime;
}

export enum GQLSchduleType {
  AI = 'AI',
  Suggestion = 'Suggestion',
  Manual = 'Manual',
  Disable = 'Disable',
  Trip = 'Trip'
}

export interface GQLVehicleLocationSetting {
  
  /**
   * location id
   */
  locationID: string;
  
  /**
   * Minimum battery level to reach directly (%)
   */
  directLevel: number;
  goal: string;
}

export interface GQLResolverTest {
  isFieldResolverWorking: boolean;
}

export interface GQLMutation {
  loginWithPassword: GQLAccount;
  loginWithIDToken: GQLAccount;
  newPriceList: GQLPriceList;
  updatePriceList: GQLPriceList;
  updateLocation: GQLLocation;
  removeLocation: boolean;
  providerMutate: GQLJSONObject;
  performAction: GQLJSONObject;
  _updateVehicleData: boolean;
  _vehicleDebug: boolean;
  _chargeCalibration?: number;
  _updatePrice: boolean;
  removeVehicle: boolean;
  updateVehicle: GQLVehicle;
  replaceVehicleSchedule: Array<GQLSchedule>;
}

export interface GQLUpdatePriceListInput {
  id: string;
  name: string;
  isPrivate: boolean;
}

export interface GQLUpdateLocationInput {
  id: string;
  name?: string;
  geoLocation?: GQLGeoLocationInput;
  
  /**
   * Radius in meters
   */
  geoFenceRadius?: number;
  priceListID?: string;
  serviceID?: string;
  providerData?: GQLJSONObject;
}

export interface GQLGeoLocationInput {
  latitude: number;
  longitude: number;
}

export interface GQLUpdateVehicleDataInput {
  id: string;
  geoLocation: GQLGeoLocationInput;
  
  /**
   * battery level (%)
   */
  batteryLevel: number;
  
  /**
   * odometer (meters)
   */
  odometer: number;
  
  /**
   * outside temperature (celcius)
   */
  outsideTemperature?: number;
  
  /**
   * inside temperature (celcius)
   */
  insideTemperature?: number;
  
  /**
   * is climate control on
   */
  climateControl: boolean;
  isDriving: boolean;
  
  /**
   * charge connection
   */
  connectedCharger?: GQLChargeConnection;
  
  /**
   * charging to level (%)
   */
  chargingTo?: number;
  
  /**
   * estimated time to complete charge (minutes)
   */
  estimatedTimeLeft?: number;
  
  /**
   * current power use (kW)
   */
  powerUse?: number;
  
  /**
   * charge added (kWh)
   */
  energyAdded?: number;
}

export enum GQLChargeConnection {
  AC = 'AC',
  DC = 'DC'
}

export interface GQLVehicleDebugInput {
  id: string;
  timestamp: GQLDateTime;
  category: string;
  data: GQLJSONObject;
}

export interface GQLUpdatePriceInput {
  priceListID: string;
  prices: Array<GQLPriceDataInput>;
}

export interface GQLPriceDataInput {
  
  /**
   * Price tariff start time
   */
  startAt: GQLDateTime;
  
  /**
   * Price in currency per kWh (5 decimal precision)
   */
  price: number;
}

export interface GQLUpdateVehicleInput {
  id: string;
  name?: string;
  maximumLevel?: number;
  schedule?: Array<GQLScheduleInput>;
  locationSettings?: Array<GQLVehicleLocationSettingInput>;
  status?: string;
  serviceID?: string;
  providerData?: GQLJSONObject;
}

export interface GQLScheduleInput {
  type: GQLSchduleType;
  
  /**
   * Battery level to reach at scheduled time (%)
   */
  level: number;
  time?: GQLDateTime;
}

export interface GQLVehicleLocationSettingInput {
  
  /**
   * location id
   */
  locationID: string;
  
  /**
   * Minimum battery level to reach directly (%)
   */
  directLevel: number;
  goal: string;
}

export interface GQLSubscription {
  pingSubscription: number;
  actionSubscription: GQLAction;
  vehicleSubscription: GQLVehicle;
}

export interface GQLAction {
  actionID: number;
  serviceID: string;
  providerName: string;
  action: string;
  data: GQLJSONObject;
}

/*********************************
 *         TYPE RESOLVERS        *
 *********************************/
/**
 * This interface define the shape of your resolver
 * Note that this type is designed to be compatible with graphql-tools resolvers
 * However, you can still use other generated interfaces to make your resolver type-safed
 */
export interface GQLResolver {
  Query?: GQLQueryTypeResolver;
  Account?: GQLAccountTypeResolver;
  PriceList?: GQLPriceListTypeResolver;
  Location?: GQLLocationTypeResolver;
  GeoLocation?: GQLGeoLocationTypeResolver;
  JSONObject?: GraphQLScalarType;
  ServiceProvider?: GQLServiceProviderTypeResolver;
  ChartData?: GQLChartDataTypeResolver;
  PriceData?: GQLPriceDataTypeResolver;
  DateTime?: GraphQLScalarType;
  ChargePlan?: GQLChargePlanTypeResolver;
  Vehicle?: GQLVehicleTypeResolver;
  Schedule?: GQLScheduleTypeResolver;
  VehicleLocationSetting?: GQLVehicleLocationSettingTypeResolver;
  ResolverTest?: GQLResolverTestTypeResolver;
  Mutation?: GQLMutationTypeResolver;
  Subscription?: GQLSubscriptionTypeResolver;
  Action?: GQLActionTypeResolver;
}
export interface GQLQueryTypeResolver<TParent = undefined> {
  account?: QueryToAccountResolver<TParent>;
  priceLists?: QueryToPriceListsResolver<TParent>;
  priceList?: QueryToPriceListResolver<TParent>;
  locations?: QueryToLocationsResolver<TParent>;
  location?: QueryToLocationResolver<TParent>;
  providerQuery?: QueryToProviderQueryResolver<TParent>;
  _serviceProviders?: QueryTo_serviceProvidersResolver<TParent>;
  chartData?: QueryToChartDataResolver<TParent>;
  vehicles?: QueryToVehiclesResolver<TParent>;
  vehicle?: QueryToVehicleResolver<TParent>;
  test?: QueryToTestResolver<TParent>;
}

export interface QueryToAccountResolver<TParent = undefined, TResult = GQLAccount> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToPriceListsResolver<TParent = undefined, TResult = Array<GQLPriceList>> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToPriceListArgs {
  id: string;
}
export interface QueryToPriceListResolver<TParent = undefined, TResult = GQLPriceList> {
  (parent: TParent, args: QueryToPriceListArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToLocationsResolver<TParent = undefined, TResult = Array<GQLLocation>> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToLocationArgs {
  id: string;
}
export interface QueryToLocationResolver<TParent = undefined, TResult = GQLLocation> {
  (parent: TParent, args: QueryToLocationArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToProviderQueryArgs {
  input: GQLJSONObject;
  name: string;
}
export interface QueryToProviderQueryResolver<TParent = undefined, TResult = GQLJSONObject> {
  (parent: TParent, args: QueryToProviderQueryArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryTo_serviceProvidersArgs {
  accept: Array<string>;
}
export interface QueryTo_serviceProvidersResolver<TParent = undefined, TResult = Array<GQLServiceProvider>> {
  (parent: TParent, args: QueryTo_serviceProvidersArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToChartDataArgs {
  locationID: string;
  vehicleID: string;
}
export interface QueryToChartDataResolver<TParent = undefined, TResult = GQLChartData> {
  (parent: TParent, args: QueryToChartDataArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToVehiclesResolver<TParent = undefined, TResult = Array<GQLVehicle>> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToVehicleArgs {
  id: string;
}
export interface QueryToVehicleResolver<TParent = undefined, TResult = GQLVehicle> {
  (parent: TParent, args: QueryToVehicleArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface QueryToTestResolver<TParent = undefined, TResult = GQLResolverTest> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLAccountTypeResolver<TParent = GQLAccount> {
  id?: AccountToIdResolver<TParent>;
  name?: AccountToNameResolver<TParent>;
  token?: AccountToTokenResolver<TParent>;
}

export interface AccountToIdResolver<TParent = GQLAccount, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface AccountToNameResolver<TParent = GQLAccount, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface AccountToTokenResolver<TParent = GQLAccount, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLPriceListTypeResolver<TParent = GQLPriceList> {
  id?: PriceListToIdResolver<TParent>;
  ownerID?: PriceListToOwnerIDResolver<TParent>;
  name?: PriceListToNameResolver<TParent>;
  isPrivate?: PriceListToIsPrivateResolver<TParent>;
}

export interface PriceListToIdResolver<TParent = GQLPriceList, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface PriceListToOwnerIDResolver<TParent = GQLPriceList, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface PriceListToNameResolver<TParent = GQLPriceList, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface PriceListToIsPrivateResolver<TParent = GQLPriceList, TResult = boolean> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLLocationTypeResolver<TParent = GQLLocation> {
  id?: LocationToIdResolver<TParent>;
  ownerID?: LocationToOwnerIDResolver<TParent>;
  name?: LocationToNameResolver<TParent>;
  geoLocation?: LocationToGeoLocationResolver<TParent>;
  geoFenceRadius?: LocationToGeoFenceRadiusResolver<TParent>;
  serviceID?: LocationToServiceIDResolver<TParent>;
  providerData?: LocationToProviderDataResolver<TParent>;
  priceListID?: LocationToPriceListIDResolver<TParent>;
  priceList?: LocationToPriceListResolver<TParent>;
}

export interface LocationToIdResolver<TParent = GQLLocation, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToOwnerIDResolver<TParent = GQLLocation, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToNameResolver<TParent = GQLLocation, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToGeoLocationResolver<TParent = GQLLocation, TResult = GQLGeoLocation> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToGeoFenceRadiusResolver<TParent = GQLLocation, TResult = number | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToServiceIDResolver<TParent = GQLLocation, TResult = string | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToProviderDataResolver<TParent = GQLLocation, TResult = GQLJSONObject | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToPriceListIDResolver<TParent = GQLLocation, TResult = string | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface LocationToPriceListResolver<TParent = GQLLocation, TResult = GQLPriceList | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLGeoLocationTypeResolver<TParent = GQLGeoLocation> {
  latitude?: GeoLocationToLatitudeResolver<TParent>;
  longitude?: GeoLocationToLongitudeResolver<TParent>;
}

export interface GeoLocationToLatitudeResolver<TParent = GQLGeoLocation, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GeoLocationToLongitudeResolver<TParent = GQLGeoLocation, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLServiceProviderTypeResolver<TParent = GQLServiceProvider> {
  ownerID?: ServiceProviderToOwnerIDResolver<TParent>;
  providerName?: ServiceProviderToProviderNameResolver<TParent>;
  serviceID?: ServiceProviderToServiceIDResolver<TParent>;
  serviceData?: ServiceProviderToServiceDataResolver<TParent>;
}

export interface ServiceProviderToOwnerIDResolver<TParent = GQLServiceProvider, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ServiceProviderToProviderNameResolver<TParent = GQLServiceProvider, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ServiceProviderToServiceIDResolver<TParent = GQLServiceProvider, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ServiceProviderToServiceDataResolver<TParent = GQLServiceProvider, TResult = GQLJSONObject> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLChartDataTypeResolver<TParent = GQLChartData> {
  locationID?: ChartDataToLocationIDResolver<TParent>;
  locationName?: ChartDataToLocationNameResolver<TParent>;
  vehicleID?: ChartDataToVehicleIDResolver<TParent>;
  batteryLevel?: ChartDataToBatteryLevelResolver<TParent>;
  levelChargeTime?: ChartDataToLevelChargeTimeResolver<TParent>;
  thresholdPrice?: ChartDataToThresholdPriceResolver<TParent>;
  chargeCurve?: ChartDataToChargeCurveResolver<TParent>;
  prices?: ChartDataToPricesResolver<TParent>;
  chargePlan?: ChartDataToChargePlanResolver<TParent>;
  directLevel?: ChartDataToDirectLevelResolver<TParent>;
  maximumLevel?: ChartDataToMaximumLevelResolver<TParent>;
}

export interface ChartDataToLocationIDResolver<TParent = GQLChartData, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToLocationNameResolver<TParent = GQLChartData, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToVehicleIDResolver<TParent = GQLChartData, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToBatteryLevelResolver<TParent = GQLChartData, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToLevelChargeTimeResolver<TParent = GQLChartData, TResult = number | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToThresholdPriceResolver<TParent = GQLChartData, TResult = number | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToChargeCurveResolver<TParent = GQLChartData, TResult = GQLJSONObject> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToPricesResolver<TParent = GQLChartData, TResult = Array<GQLPriceData>> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToChargePlanResolver<TParent = GQLChartData, TResult = Array<GQLChargePlan> | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToDirectLevelResolver<TParent = GQLChartData, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChartDataToMaximumLevelResolver<TParent = GQLChartData, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLPriceDataTypeResolver<TParent = GQLPriceData> {
  startAt?: PriceDataToStartAtResolver<TParent>;
  price?: PriceDataToPriceResolver<TParent>;
}

export interface PriceDataToStartAtResolver<TParent = GQLPriceData, TResult = GQLDateTime> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface PriceDataToPriceResolver<TParent = GQLPriceData, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLChargePlanTypeResolver<TParent = GQLChargePlan> {
  chargeType?: ChargePlanToChargeTypeResolver<TParent>;
  chargeStart?: ChargePlanToChargeStartResolver<TParent>;
  chargeStop?: ChargePlanToChargeStopResolver<TParent>;
  level?: ChargePlanToLevelResolver<TParent>;
  comment?: ChargePlanToCommentResolver<TParent>;
}

export interface ChargePlanToChargeTypeResolver<TParent = GQLChargePlan, TResult = GQLChargeType> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChargePlanToChargeStartResolver<TParent = GQLChargePlan, TResult = GQLDateTime | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChargePlanToChargeStopResolver<TParent = GQLChargePlan, TResult = GQLDateTime | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChargePlanToLevelResolver<TParent = GQLChargePlan, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ChargePlanToCommentResolver<TParent = GQLChargePlan, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLVehicleTypeResolver<TParent = GQLVehicle> {
  id?: VehicleToIdResolver<TParent>;
  ownerID?: VehicleToOwnerIDResolver<TParent>;
  serviceID?: VehicleToServiceIDResolver<TParent>;
  name?: VehicleToNameResolver<TParent>;
  maximumLevel?: VehicleToMaximumLevelResolver<TParent>;
  schedule?: VehicleToScheduleResolver<TParent>;
  providerData?: VehicleToProviderDataResolver<TParent>;
  geoLocation?: VehicleToGeoLocationResolver<TParent>;
  locationID?: VehicleToLocationIDResolver<TParent>;
  location?: VehicleToLocationResolver<TParent>;
  locationSettings?: VehicleToLocationSettingsResolver<TParent>;
  batteryLevel?: VehicleToBatteryLevelResolver<TParent>;
  odometer?: VehicleToOdometerResolver<TParent>;
  outsideTemperature?: VehicleToOutsideTemperatureResolver<TParent>;
  insideTemperature?: VehicleToInsideTemperatureResolver<TParent>;
  climateControl?: VehicleToClimateControlResolver<TParent>;
  isConnected?: VehicleToIsConnectedResolver<TParent>;
  chargingTo?: VehicleToChargingToResolver<TParent>;
  estimatedTimeLeft?: VehicleToEstimatedTimeLeftResolver<TParent>;
  isDriving?: VehicleToIsDrivingResolver<TParent>;
  status?: VehicleToStatusResolver<TParent>;
  smartStatus?: VehicleToSmartStatusResolver<TParent>;
  chargePlan?: VehicleToChargePlanResolver<TParent>;
  updated?: VehicleToUpdatedResolver<TParent>;
}

export interface VehicleToIdResolver<TParent = GQLVehicle, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToOwnerIDResolver<TParent = GQLVehicle, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToServiceIDResolver<TParent = GQLVehicle, TResult = string | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToNameResolver<TParent = GQLVehicle, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToMaximumLevelResolver<TParent = GQLVehicle, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToScheduleResolver<TParent = GQLVehicle, TResult = Array<GQLSchedule>> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToProviderDataResolver<TParent = GQLVehicle, TResult = GQLJSONObject> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToGeoLocationResolver<TParent = GQLVehicle, TResult = GQLGeoLocation | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToLocationIDResolver<TParent = GQLVehicle, TResult = string | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToLocationResolver<TParent = GQLVehicle, TResult = GQLLocation | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToLocationSettingsResolver<TParent = GQLVehicle, TResult = Array<GQLVehicleLocationSetting>> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToBatteryLevelResolver<TParent = GQLVehicle, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToOdometerResolver<TParent = GQLVehicle, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToOutsideTemperatureResolver<TParent = GQLVehicle, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToInsideTemperatureResolver<TParent = GQLVehicle, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToClimateControlResolver<TParent = GQLVehicle, TResult = boolean> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToIsConnectedResolver<TParent = GQLVehicle, TResult = boolean> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToChargingToResolver<TParent = GQLVehicle, TResult = number | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToEstimatedTimeLeftResolver<TParent = GQLVehicle, TResult = number | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToIsDrivingResolver<TParent = GQLVehicle, TResult = boolean> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToStatusResolver<TParent = GQLVehicle, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToSmartStatusResolver<TParent = GQLVehicle, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToChargePlanResolver<TParent = GQLVehicle, TResult = Array<GQLChargePlan> | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleToUpdatedResolver<TParent = GQLVehicle, TResult = GQLDateTime> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLScheduleTypeResolver<TParent = GQLSchedule> {
  type?: ScheduleToTypeResolver<TParent>;
  level?: ScheduleToLevelResolver<TParent>;
  time?: ScheduleToTimeResolver<TParent>;
}

export interface ScheduleToTypeResolver<TParent = GQLSchedule, TResult = GQLSchduleType> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ScheduleToLevelResolver<TParent = GQLSchedule, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ScheduleToTimeResolver<TParent = GQLSchedule, TResult = GQLDateTime | null> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLVehicleLocationSettingTypeResolver<TParent = GQLVehicleLocationSetting> {
  locationID?: VehicleLocationSettingToLocationIDResolver<TParent>;
  directLevel?: VehicleLocationSettingToDirectLevelResolver<TParent>;
  goal?: VehicleLocationSettingToGoalResolver<TParent>;
}

export interface VehicleLocationSettingToLocationIDResolver<TParent = GQLVehicleLocationSetting, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleLocationSettingToDirectLevelResolver<TParent = GQLVehicleLocationSetting, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface VehicleLocationSettingToGoalResolver<TParent = GQLVehicleLocationSetting, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLResolverTestTypeResolver<TParent = GQLResolverTest> {
  isFieldResolverWorking?: ResolverTestToIsFieldResolverWorkingResolver<TParent>;
}

export interface ResolverTestToIsFieldResolverWorkingResolver<TParent = GQLResolverTest, TResult = boolean> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLMutationTypeResolver<TParent = undefined> {
  loginWithPassword?: MutationToLoginWithPasswordResolver<TParent>;
  loginWithIDToken?: MutationToLoginWithIDTokenResolver<TParent>;
  newPriceList?: MutationToNewPriceListResolver<TParent>;
  updatePriceList?: MutationToUpdatePriceListResolver<TParent>;
  updateLocation?: MutationToUpdateLocationResolver<TParent>;
  removeLocation?: MutationToRemoveLocationResolver<TParent>;
  providerMutate?: MutationToProviderMutateResolver<TParent>;
  performAction?: MutationToPerformActionResolver<TParent>;
  _updateVehicleData?: MutationTo_updateVehicleDataResolver<TParent>;
  _vehicleDebug?: MutationTo_vehicleDebugResolver<TParent>;
  _chargeCalibration?: MutationTo_chargeCalibrationResolver<TParent>;
  _updatePrice?: MutationTo_updatePriceResolver<TParent>;
  removeVehicle?: MutationToRemoveVehicleResolver<TParent>;
  updateVehicle?: MutationToUpdateVehicleResolver<TParent>;
  replaceVehicleSchedule?: MutationToReplaceVehicleScheduleResolver<TParent>;
}

export interface MutationToLoginWithPasswordArgs {
  password: string;
}
export interface MutationToLoginWithPasswordResolver<TParent = undefined, TResult = GQLAccount> {
  (parent: TParent, args: MutationToLoginWithPasswordArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToLoginWithIDTokenArgs {
  idToken: string;
}
export interface MutationToLoginWithIDTokenResolver<TParent = undefined, TResult = GQLAccount> {
  (parent: TParent, args: MutationToLoginWithIDTokenArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToNewPriceListArgs {
  id?: string;
  isPrivate?: boolean;
  name: string;
}
export interface MutationToNewPriceListResolver<TParent = undefined, TResult = GQLPriceList> {
  (parent: TParent, args: MutationToNewPriceListArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToUpdatePriceListArgs {
  input: GQLUpdatePriceListInput;
}
export interface MutationToUpdatePriceListResolver<TParent = undefined, TResult = GQLPriceList> {
  (parent: TParent, args: MutationToUpdatePriceListArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToUpdateLocationArgs {
  input: GQLUpdateLocationInput;
}
export interface MutationToUpdateLocationResolver<TParent = undefined, TResult = GQLLocation> {
  (parent: TParent, args: MutationToUpdateLocationArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToRemoveLocationArgs {
  confirm: string;
  id: string;
}
export interface MutationToRemoveLocationResolver<TParent = undefined, TResult = boolean> {
  (parent: TParent, args: MutationToRemoveLocationArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToProviderMutateArgs {
  input: GQLJSONObject;
  name: string;
}
export interface MutationToProviderMutateResolver<TParent = undefined, TResult = GQLJSONObject> {
  (parent: TParent, args: MutationToProviderMutateArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToPerformActionArgs {
  data?: GQLJSONObject;
  action: string;
  serviceID: string;
  actionID?: number;
}
export interface MutationToPerformActionResolver<TParent = undefined, TResult = GQLJSONObject> {
  (parent: TParent, args: MutationToPerformActionArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationTo_updateVehicleDataArgs {
  input: GQLUpdateVehicleDataInput;
}
export interface MutationTo_updateVehicleDataResolver<TParent = undefined, TResult = boolean> {
  (parent: TParent, args: MutationTo_updateVehicleDataArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationTo_vehicleDebugArgs {
  input: GQLVehicleDebugInput;
}
export interface MutationTo_vehicleDebugResolver<TParent = undefined, TResult = boolean> {
  (parent: TParent, args: MutationTo_vehicleDebugArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationTo_chargeCalibrationArgs {
  powerUse?: number;
  duration?: number;
  level?: number;
  vehicleID: string;
}
export interface MutationTo_chargeCalibrationResolver<TParent = undefined, TResult = number | null> {
  (parent: TParent, args: MutationTo_chargeCalibrationArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationTo_updatePriceArgs {
  input: GQLUpdatePriceInput;
}
export interface MutationTo_updatePriceResolver<TParent = undefined, TResult = boolean> {
  (parent: TParent, args: MutationTo_updatePriceArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToRemoveVehicleArgs {
  confirm: string;
  id: string;
}
export interface MutationToRemoveVehicleResolver<TParent = undefined, TResult = boolean> {
  (parent: TParent, args: MutationToRemoveVehicleArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToUpdateVehicleArgs {
  input: GQLUpdateVehicleInput;
}
export interface MutationToUpdateVehicleResolver<TParent = undefined, TResult = GQLVehicle> {
  (parent: TParent, args: MutationToUpdateVehicleArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface MutationToReplaceVehicleScheduleArgs {
  newSchedule: Array<GQLScheduleInput>;
  oldSchedule: Array<GQLScheduleInput>;
  id: string;
}
export interface MutationToReplaceVehicleScheduleResolver<TParent = undefined, TResult = Array<GQLSchedule>> {
  (parent: TParent, args: MutationToReplaceVehicleScheduleArgs, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface GQLSubscriptionTypeResolver<TParent = undefined> {
  pingSubscription?: SubscriptionToPingSubscriptionResolver<TParent>;
  actionSubscription?: SubscriptionToActionSubscriptionResolver<TParent>;
  vehicleSubscription?: SubscriptionToVehicleSubscriptionResolver<TParent>;
}

export interface SubscriptionToPingSubscriptionResolver<TParent = undefined, TResult = number> {
  resolve?: (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo) => TResult | Promise<TResult>;
  subscribe: (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo) => AsyncIterator<TResult> | Promise<AsyncIterator<TResult>>;
}

export interface SubscriptionToActionSubscriptionArgs {
  serviceID?: string;
  providerName?: string;
}
export interface SubscriptionToActionSubscriptionResolver<TParent = undefined, TResult = GQLAction> {
  resolve?: (parent: TParent, args: SubscriptionToActionSubscriptionArgs, context: any, info: GraphQLResolveInfo) => TResult | Promise<TResult>;
  subscribe: (parent: TParent, args: SubscriptionToActionSubscriptionArgs, context: any, info: GraphQLResolveInfo) => AsyncIterator<TResult> | Promise<AsyncIterator<TResult>>;
}

export interface SubscriptionToVehicleSubscriptionArgs {
  id: string;
}
export interface SubscriptionToVehicleSubscriptionResolver<TParent = undefined, TResult = GQLVehicle> {
  resolve?: (parent: TParent, args: SubscriptionToVehicleSubscriptionArgs, context: any, info: GraphQLResolveInfo) => TResult | Promise<TResult>;
  subscribe: (parent: TParent, args: SubscriptionToVehicleSubscriptionArgs, context: any, info: GraphQLResolveInfo) => AsyncIterator<TResult> | Promise<AsyncIterator<TResult>>;
}

export interface GQLActionTypeResolver<TParent = GQLAction> {
  actionID?: ActionToActionIDResolver<TParent>;
  serviceID?: ActionToServiceIDResolver<TParent>;
  providerName?: ActionToProviderNameResolver<TParent>;
  action?: ActionToActionResolver<TParent>;
  data?: ActionToDataResolver<TParent>;
}

export interface ActionToActionIDResolver<TParent = GQLAction, TResult = number> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ActionToServiceIDResolver<TParent = GQLAction, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ActionToProviderNameResolver<TParent = GQLAction, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ActionToActionResolver<TParent = GQLAction, TResult = string> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}

export interface ActionToDataResolver<TParent = GQLAction, TResult = GQLJSONObject> {
  (parent: TParent, args: {}, context: any, info: GraphQLResolveInfo): TResult | Promise<TResult>;
}
