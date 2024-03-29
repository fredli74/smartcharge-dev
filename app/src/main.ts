import "./plugins/hooks";
import Vue from "vue";
import apollo, { apolloProvider } from "./plugins/apollo";
import vuetify from "./plugins/vuetify";
import router from "./router";
import "./register-service-worker";
import "./plugins/visible";
import App from "./app.vue";

Vue.config.productionTip = false;
Vue.config.devtools = true;

(async () => {
  try {
    const token = localStorage.getItem("token");
    if (token !== null) {
      await apollo.loginWithAPIToken(token);
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
