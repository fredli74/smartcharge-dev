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
  const optionString = options.map(f => "$" + f).join(",");
  let model = "m3";
  let view = `STUD_${sideView ? "SIDE" : "3QTR"}`;
  switch (vehicle.providerData.car_type) {
    case "models2":
      model = "ms";
      view += "_V2";
      break;
    case "modelx":
      model = "mx";
      break;
    case "modely":
      model = "my";
      break;
  }
  return `https://static-assets.tesla.com/configurator/compositor?&options=${optionString}&view=${view}&model=${model}&size=1441&bkba_opt=1&version=0.0.25`;
}
