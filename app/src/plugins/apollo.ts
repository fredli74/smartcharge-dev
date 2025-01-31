import Vue from "vue";
import VueApollo from "vue-apollo";
import { SCClient } from "@shared/sc-client.js";

Vue.use(VueApollo);

export function newSCClient() {
  if (!Vue.prototype.$scConfig) {
    throw new Error("SC Client: Vue.prototype.$scConfig is not set!");
  }
  const url = Vue.prototype.$scConfig.PUBLIC_URL || (location && location.origin);
  const ws_url = url.replace(/^http/, "ws");

  return new SCClient(url, ws_url);
}

export function newApolloProvider(client: SCClient): VueApollo {
  return new VueApollo({ defaultClient: client });
}
