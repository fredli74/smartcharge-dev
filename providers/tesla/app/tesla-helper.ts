import { Vehicle } from "@server/gql/vehicle-type";

// List entry when adding a new Tesla vehicle
export interface TeslaNewListEntry {
  name: string; // name of vehicle
  id: string; // tesla id to control vehicle
  vin: string; // For UI display
  service_uuid: string; // provider uuid
  controlled: boolean; // Already controlled by smartcharge
}

export function vehicleImage(vehicle: Vehicle): string {
  let options = ["W38B", "PPSW"];
  if (vehicle.providerData.option_codes) {
    options = vehicle.providerData.option_codes;
  }
  const optionString = options.map(f => "$" + f).join(",");
  return `https://static-assets.tesla.com/configurator/compositor?&options=${optionString}&view=STUD_3QTR&model=m3&size=1441&bkba_opt=1&version=0.0.25`;
}
