import { IProviderApp } from "@providers/provider-apps";
import provider from "../index";
import TeslaVue from "./tesla.vue";

const app: IProviderApp = {
  ...provider,
  logo: require("./tesla-logo.jpg"),
  vue: TeslaVue
};
export default app;
