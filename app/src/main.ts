import "./plugins/hooks";
import Vue from "vue";
import vuetify from "./plugins/vuetify.js";
import router from "./router.js";
import "./register-service-worker";
import "./plugins/visible";
import App from "./app.vue";
import { newApolloProvider, newSCClient } from "./plugins/apollo";

Vue.config.productionTip = false;
Vue.config.devtools = true;

Vue.prototype.$scConfig = {};
Vue.prototype.$scClient = undefined;

function preLaunchError(message: string) {
  const el = document.createElement("div");
  el.innerHTML = `<div style="text-align:center; position: fixed; top: 0; left: 0; right: 0; z-index: 1000; background-color: red; color: white; padding: 1em;">${message}</div>`;
  document.body.appendChild(el);
  console.error(message);
}

(async () => {
  try {
    const response = await fetch("/api/config");
    Vue.prototype.$scConfig = await response.json();
  } catch (err) {
    preLaunchError(`Failed to fetch config, check server setup: ${err}`);
  }

  if (Vue.prototype.$scConfig.SINGLE_USER === undefined) {
    preLaunchError("Config missing SINGLE_USER setting, check server setup");
  }

  Vue.prototype.$scClient = newSCClient();
  const apolloProvider = newApolloProvider(Vue.prototype.$scClient);
  if (Vue.prototype.$scClient === undefined || apolloProvider === undefined) {
    preLaunchError("Failed to create Apollo client, check server setup");
  }
  
  try {
    const token = localStorage.getItem("token");
    if (token !== null) {
      await Vue.prototype.$scClient.loginWithAPIToken(token);
    }
  } catch (err: any) {
    if (err.networkError && err.networkError.statusCode === 401) {
      localStorage.removeItem("token");
      console.log("Invalid access token, new login required");
    } else {
      preLaunchError(`Failed to login with token: ${err.message || err}`);
    }
  }

  new Vue({
    router,
    vuetify,
    apolloProvider,
    render: (h) => h(App),
  }).$mount("#app");

})();
