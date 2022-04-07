import { IProviderApp } from "@providers/provider-app";
import provider from "../index";
import NordpoolVue from "./nordpool.vue";

const app: IProviderApp = {
  ...provider,
  logo: require("./nordpool-logo.png"),
  vue: NordpoolVue,
};
export default app;
