import { IProviderApp } from "@providers/provider-app";
import provider from "../index";
import TeslaVue from "./tesla.vue";
import { vehicleImage } from "./tesla-helper";

const app: IProviderApp = {
  ...provider,
  logo: require("./tesla-logo.jpg"),
  image: vehicleImage,
  vue: TeslaVue
};
export default app;
