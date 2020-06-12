import { GQLVehicle } from "@shared/sc-schema";

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
  let options = ["W38B", "PPSW"];
  if (vehicle.providerData.option_codes) {
    options = vehicle.providerData.option_codes;
  }
  let model = "m3";
  let background = 1;
  switch (vehicle.providerData.car_type) {
    case "models":
      model = "msl";
      if (dark) {
        // There is no view with dark background
        sideView = true;
      } else {
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
  }
  const view = `STUD_${sideView ? "SIDE" : "3QTR"}`;
  const optionString = options.join(",");
  return `https://static-assets.tesla.com/v1/compositor/?model=${model}&view=${view}&size=1440&options=${optionString}&bkba_opt=${background}&context=design_studio_2`;
}
