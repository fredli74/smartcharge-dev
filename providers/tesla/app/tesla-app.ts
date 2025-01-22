import { IProviderApp } from "@providers/provider-app.js";
import provider from "../index";
import TeslaVue from "./tesla.vue";
import { vehicleImage } from "./tesla-helper.js";

import logo from "./tesla-logo.jpg";

const app: IProviderApp = {
  ...provider,
  logo,
  image: vehicleImage,
  vue: TeslaVue,
};
export default app;
