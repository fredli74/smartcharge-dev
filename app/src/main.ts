import "./plugins/hooks";
import Vue from "vue";
import vuetify from "./plugins/vuetify.js";
import router from "./router.js";
import "./plugins/visible";
import App from "./app.vue";
import { newApolloProvider, newSCClient } from "./plugins/apollo";
import { registerSW } from "virtual:pwa-register";

Vue.config.productionTip = false;
Vue.config.devtools = true;

Vue.prototype.$scConfig = {};
Vue.prototype.$scClient = undefined;

// Register the PWA service worker and force-reload when a new version is ready.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
});

function preLaunchError(message: string) {
  let errContainer = document.querySelector("#pre-launch-error") as HTMLDivElement | null;
  if (!errContainer) {
    errContainer = document.createElement("div");
    errContainer.id = "pre-launch-error";
    errContainer.style.cssText = "position: fixed; top: 0; left: 0; right: 0; z-index: 1000; background-color: red; color: white; padding: 1em; text-align: center; font-size: 16px;";
    document.body.appendChild(errContainer);
  }

  const el = document.createElement("p");
  el.textContent = message;
  errContainer.appendChild(el);
  console.error(message);
}

(async function initApp() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      preLaunchError("Server is down or not reachable, try again later, or report the issue");
      return;
    }
    Vue.prototype.$scConfig = await response.json();
  } catch (err) {
    preLaunchError(`Failed to fetch config, check server setup: ${err}`);
    return;
  }
  if (Vue.prototype.$scConfig.SINGLE_USER === undefined) {
    preLaunchError("Config missing SINGLE_USER setting, check server setup");
    return;
  }
  
  Vue.prototype.$scClient = newSCClient();
  const apolloProvider = newApolloProvider(Vue.prototype.$scClient);
  if (Vue.prototype.$scClient === undefined || apolloProvider === undefined) {
    preLaunchError("Failed to create Apollo client, check server setup");
    return;
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
      return;
    }
  }

  new Vue({
    router,
    vuetify,
    apolloProvider,
    render: (h) => h(App),
  }).$mount("#app");

})();
