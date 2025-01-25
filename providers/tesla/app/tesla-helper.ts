import { GQLVehicle } from "@shared/sc-schema.js";

// List entry when adding a new Tesla vehicle
export interface TeslaNewListEntry {
  name: string; // name of vehicle
  id: string; // tesla id to control vehicle
  vin: string; // Vehicle Identification Number (only ID that we can rely on)
  service_uuid: string; // provider uuid
  vehicle_uuid: string; // smartcharge vehicle_uuid
}

export function vehicleImage(
  vehicle: GQLVehicle,
  sideView?: boolean,
  dark?: boolean
): string {
  let model = "my";
  let background = 1;
  let options =
    vehicle.providerData.option_codes &&
    vehicle.providerData.option_codes.length > 0
      ? vehicle.providerData.option_codes.join(",")
      : "$MTY13,$PPSW,$WY19B,$INPB0";

  switch (vehicle.providerData.car_type) {
    case "models":
      model = "msl";
      if (dark) {
        // There is no view with dark background
        sideView = true;
      } else if (!sideView) {
        // Force white background for legacy model images
        background = 2;
      }
      break;
    case "models2":
      model = "ms";
      break;
    case "modelx":
      model = "mx";
      break;
    case "modely":
      model = "my";
      break;
    case "model3":
      model = "m3";
      if (sideView) {
        // W32B and W32D does not exist in side view
        // Refreshed stiletto only works in 3QTR view without black trim
        options = options.replace(/(\$W32B|\$W32D|\$W41B)/g, "$W39B");
      }
      break;
    case "lychee":
      model = "ms";
      break;
    case "tamarind":
      model = "mx";
      break;
  }
  // if no $I\DC0\d option is present, add $IBC00
  if (!options.match(/\$I.C0\d/)) {
    options = "$IBC00," + options;
  }

  const view = `STUD_${sideView ? "SIDE" : "3QTR"}`;
  return `https://static-assets.tesla.com/v1/compositor/?model=${model}&view=${view}&size=1440&options=${options}&bkba_opt=${background}&context=design_studio_2`;
}
