import Vue from "vue";
import Router from "vue-router";
import Home from "./views/home.vue";
import About from "./views/about.vue";
import eventBus, { BusEvent } from "./plugins/event-bus.js";

Vue.use(Router);

const router = new Router({
  mode: "history",
  routes: [
    {
      path: "/index.html",
      alias: "/",
      component: Home,
      meta: { login: true, root: true },
    },
    {
      path: "/",
      name: "home",
      component: Home,
      meta: { login: true, root: true },
    },
    {
      path: "/about",
      name: "about",
      meta: { root: true, fullpage: true },
      component: About,
    },
    {
      path: "/login",
      name: "login",
      component: () => import("./views/login.vue"),
      meta: { root: true },
    },

    {
      path: "/add/:type",
      name: "add",
      component: () => import("./views/add.vue"),
      meta: { login: true },
    },
    {
      path: "/provider/:provider/:page",
      name: "provider",
      component: () => import("./views/provider-wrapper.vue"),
      meta: { login: true },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("./views/settings.vue"),
      meta: { login: true },
    },
    {
      path: "/vehicle/:id",
      name: "vehicle",
      component: () => import("./views/vehicle.vue"),
      meta: { login: true },
    },
    {
      path: "*",
      component: Vue.component("PageNotFound", {
        created: () => {},
        render: (createElement) => {
          return createElement(
            "h4",
            {
              style: {
                width: "100%",
                textAlign: "center",
                wordBreak: "break-all",
              },
            },
            `404 - ${location}`
          );
        },
      }),
    },
  ],
});
router.beforeEach((to, _from, next) => {
  if (!Vue.prototype.$scClient.authorized && to.meta && to.meta.login) {
    next({ name: "about" });
  } else {
    next();
  }
});
router.afterEach((_to, _from) => {
  eventBus.$emit(BusEvent.AlertClear);
});
export default router;
