import "./plugins/hooks";
import Vue from "vue";
import apollo, { apolloProvider } from "./plugins/apollo";
import vuetify from "./plugins/vuetify";
import router from "./router";
import "./registerServiceWorker";
import { Account } from "@shared/gql-types";
import { Component } from "vue-property-decorator";
import App from "./app.vue";

Vue.config.productionTip = false;
Vue.config.devtools = true;

(async () => {
  await apollo.init();

  new Vue({
    router,
    vuetify,
    apolloProvider,
    render: h => h(App)
  }).$mount("#app");
})();
