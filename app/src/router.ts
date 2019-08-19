import Vue from "vue";
import Router from "vue-router";
import Home from "./views/home.vue";
import About from "./views/about.vue";
import apollo from "./plugins/apollo";
import eventBus from "./plugins/event-bus";

Vue.use(Router);

const NotFoundComponent = Vue.component("page-not-found", {
  created: () => {},
  render: createElement => {
    return createElement("h1", `404 - ${location}`);
  }
});

const router = new Router({
  mode: "history",
  base: process.env.BASE_URL,
  routes: [
    { path: "/index.html", component: Home, alias: "/" },
    {
      path: "/",
      name: "home",
      component: Home
    },
    {
      path: "/about",
      name: "about",
      component: About,
      meta: { public: true }
    },
    {
      path: "/login",
      name: "login",
      component: () =>
        import(/* webpackChunkName: "login" */ "./views/login.vue"),
      meta: { public: true }
    },

    {
      path: "/add/:type",
      name: "add",
      component: () => import(/* webpackChunkName: "add" */ "./views/add.vue"),
      meta: {}
    },
    {
      path: "/provider/:provider/:page",
      name: "provider",
      component: () =>
        import(/* webpackChunkName: "providerwrapper" */ "./views/provider-wrapper.vue"),
      meta: {}
    },
    {
      path: "/vehicle/:id",
      name: "vehicle",
      component: () =>
        import(/* webpackChunkName: "vehicle" */ "./views/vehicle.vue"),
      meta: {}
    },
    { path: "*", component: NotFoundComponent }
  ]
});
router.beforeEach((to, _from, next) => {
  if (!to.meta.public && !apollo.authorized) {
    next({ name: "about" });
  } else {
    next();
  }
});
router.afterEach((_to, _from) => {
  eventBus.$emit("ALERT_CLEAR");
});
export default router;
