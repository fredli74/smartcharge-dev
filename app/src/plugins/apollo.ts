import Vue from "vue";
import VueApollo from "vue-apollo";
import config from "@shared/smartcharge-config.json";
import { SCClient } from "@shared/sc-client";

Vue.use(VueApollo);

const client = new SCClient(config.SERVER_HOST);
export default client;

export const apolloProvider = new VueApollo({ defaultClient: client });
