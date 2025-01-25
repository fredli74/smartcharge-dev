import Vue from "vue";
import VueApollo from "vue-apollo";
import config from "@shared/smartcharge-config.js";
import { SCClient } from "@shared/sc-client.js";

Vue.use(VueApollo);

const url = config.PUBLIC_URL || (location && location.origin);
const ws_url = url.replace(/^http/, "ws");

const client = new SCClient(url, ws_url);
export default client;

export const apolloProvider = new VueApollo({ defaultClient: client });
