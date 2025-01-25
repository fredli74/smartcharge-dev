import "@mdi/font/css/materialdesignicons.css";
import Vue from "vue";
import Vuetify from "vuetify/lib";
import { Resize } from "vuetify/lib/directives";

Vue.use(Vuetify, {
  directives: {
    Resize,
  },
});

export default new Vuetify({
  icons: {
    iconfont: "mdi", // default - only for display purposes
  },
});
