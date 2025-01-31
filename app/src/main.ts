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

(async () => {
  try {
    const response = await fetch("/api/config");
    Vue.prototype.$scConfig = await response.json();
  } catch (err) {
    console.error("Failed to fetch config:", err);
  }

  Vue.prototype.$scClient = newSCClient();
  const apolloProvider = newApolloProvider(Vue.prototype.$scClient);
  
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
      console.error(err.message || err);
    }
  }

  new Vue({
    router,
    vuetify,
    apolloProvider,
    render: (h) => h(App),
  }).$mount("#app");

})();
