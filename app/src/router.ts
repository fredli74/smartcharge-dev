import Vue from "vue";
import Router from "vue-router";
import Home from "./views/home.vue";
import apollo from "./plugins/apollo";
import eventBus from "./plugins/event-bus";

Vue.use(Router);

const NotFoundComponent = Vue.component("page-not-found", {
  created: () => {},
  render: createElement => {
    return createElement("h1", "404");
  }
});

const router = new Router({
  mode: "history",
  base: process.env.BASE_URL,
  routes: [
    {
      path: "/login",
      name: "login",
      component: () =>
        import(/* webpackChunkName: "login" */ "./views/login.vue"),
      meta: { public: true }
    },
    {
      path: "/",
      name: "home",
      component: Home
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
  console.log(to);
  if (!to.meta.public && !apollo.authorized) {
    next({ name: "login" });
  } else {
    next();
  }
});
router.afterEach((_to, _from) => {
  eventBus.$emit("ALERT_CLEAR");
});
export default router;
