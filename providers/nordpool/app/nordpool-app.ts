import { IProviderApp } from "@providers/provider-app.js";
import provider from "../index";
import NordpoolVue from "./nordpool.vue";

import logo from "./nordpool-logo.png";

const app: IProviderApp = {
  ...provider,
  logo,
  vue: NordpoolVue,
};
export default app;