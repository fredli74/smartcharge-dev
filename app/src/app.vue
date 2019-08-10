<template>
  <v-app>
    <v-app-bar app color="secondary" dark>
      <v-toolbar-title class="headline text-uppercase">
        <router-link id="homelink" to="/">
          <span>smartcharge.d</span>
          <span class="font-weight-light">ev</span>
        </router-link>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn v-if="authorized" text @click="logout">logout</v-btn>
      <v-btn v-else color="primary" @click="login">login</v-btn>
    </v-app-bar>
    <v-content>
      <v-container fluid>
        <v-layout row justify-space-around>
          <v-flex xs12 sm10 md8>
            <v-alert v-model="error.show" type="error" prominent>{{
              error.message
            }}</v-alert>
            <v-alert v-model="warning.show" type="warning">{{
              warning.message
            }}</v-alert>
          </v-flex>
        </v-layout>
        <v-layout row justify-space-around>
          <router-view></router-view>
        </v-layout>
      </v-container>
    </v-content>

    <v-footer app>
      <!-- -->
    </v-footer>
  </v-app>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "./plugins/apollo";
import eventBus from "./plugins/event-bus";

class AlertMessage {
  show: boolean = false;
  message: string = "";
}
@Component({
  components: {}
})
export default class App extends Vue {
  authorized!: boolean;
  warning!: AlertMessage;
  error!: AlertMessage;
  data() {
    return {
      authorized: apollo.authorized,
      warning: new AlertMessage(),
      error: new AlertMessage()
      //
    };
  }

  async mounted() {
    eventBus.$on("ALERT_ERROR", (message: string) => {
      this.error.message = message;
      this.error.show = true;
    });
    eventBus.$on("ALERT_WARNING", (message: string) => {
      this.warning.message = message;
      this.warning.show = true;
    });
    eventBus.$on("ALERT_CLEAR", () => {
      this.warning.show = false;
      this.error.show = false;
    });
    eventBus.$on("AUTHENTICATION_CHANGED", () => {
      this.authorized = apollo.authorized;
    });
  }
  errorCaptured(err: Error, _vm: Vue, _info: string) {
    this.error.message = err.message || (err as any).toString();
    this.error.show = true;
    return false;
  }

  login() {
    this.$router.push("/login");
  }
  async logout() {
    await apollo.logout();
    eventBus.$emit("AUTHENTICATION_CHANGED");
    this.$router.push("/about");
  }
}
</script>

<style>
a#homelink {
  color: white;
  text-decoration: none;
}
@media (min-width: 640px) {
  .vga-limit {
    max-width: 640px !important;
  }
}
@media (min-width: 800px) {
  .svga-limit {
    max-width: 800px !important;
  }
}
@media (min-width: 1024px) {
  .xvga-limit {
    max-width: 1024px !important;
  }
}
</style>
