import { IProviderApp } from "@providers/provider-app";
import provider from "../index";
import TibberVue from "./tibber.vue";

const app: IProviderApp = {
  ...provider,
  logo: require("./tibber-logo.png"),
  vue: TibberVue
};
export default app;
