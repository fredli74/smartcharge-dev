import { Vehicle } from "@server/gql/vehicle-type";

// List entry when adding a new Tesla vehicle
export interface TeslaNewListEntry {
  name: string; // name of vehicle
  id: string; // tesla id to control vehicle
  vin: string; // For UI display
  service_uuid: string; // provider uuid
  controlled: boolean; // Already controlled by smartcharge
}

export function vehicleImage(vehicle: Vehicle, sideView?: boolean): string {
  let options = ["W38B", "PPSW"];
  if (vehicle.providerData.option_codes) {
    options = vehicle.providerData.option_codes;
  }
  let model = "m3";
  let view = `STUD_${sideView ? "SIDE" : "3QTR"}`;
  switch (vehicle.providerData.car_type) {
    case "models":
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
  const optionString = options.join(",");
  return `https://static-assets.tesla.com/v1/compositor/?model=${model}&view=${view}&size=1440&options=${optionString}&bkba_opt=1&context=design_studio_2`;
}
