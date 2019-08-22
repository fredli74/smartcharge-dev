<template>
  <v-app>
    <v-app-bar id="app-bar" app flat color="secondary" dark>
      <v-toolbar-title class="headline text-uppercase">
        <router-link id="homelink" to="/">
          <span>smartcharge.d</span>
          <span class="font-weight-light">ev</span>
        </router-link>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <span id="version" @click="appReload()">{{ version }}</span>
      <v-spacer></v-spacer>
      <v-btn v-if="authorized" text @click="logout">logout</v-btn>
      <v-btn v-else color="primary" @click="login">login</v-btn>
    </v-app-bar>
    <v-content id="app-content">
      <v-container fluid>
        <v-layout row justify-space-around>
          <v-flex xs12 class="px-4">
            <v-alert v-model="error.show" dismissible type="error" prominent>{{
              error.message
            }}</v-alert>
            <v-alert v-model="warning.show" dismissible type="warning">{{
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
import eventBus, { BusEvent } from "./plugins/event-bus";
import { gql } from "apollo-server-core";

declare var COMMIT_HASH: string;

interface AlertMessage {
  show: boolean;
  message: string | undefined;
}
@Component({
  components: {},
  apollo: {
    $subscribe: {
      ping: {
        query: gql`
          subscription {
            pingSubscription
          }
        `
      }
    }
  }
})
export default class App extends Vue {
  authorized!: boolean;
  warning!: AlertMessage;
  error!: AlertMessage;
  data() {
    return {
      authorized: apollo.authorized,
      warning: { show: false, message: undefined },
      error: { show: false, message: undefined }
      //
    };
  }

  async mounted() {
    eventBus.$on(BusEvent.AlertError, (message: string) => {
      this.error.message = message;
      this.error.show = true;
    });
    eventBus.$on(BusEvent.AlertWarning, (message: string) => {
      this.warning.message = message;
      this.warning.show = true;
    });
    eventBus.$on(BusEvent.AlertClear, () => {
      this.warning.show = false;
      this.error.show = false;
    });
    eventBus.$on(BusEvent.AuthenticationChange, () => {
      this.authorized = apollo.authorized;
    });
  }
  errorCaptured(err: Error, _vm: Vue, _info: string) {
    if (err.message && err.name) {
      this.error.message = `${err.name}: ${err.message}`;
    } else {
      this.error.message = (err as any).toString();
    }
    this.error.show = true;
    return false;
  }

  login() {
    this.$router.push("/login");
  }
  async logout() {
    await apollo.logout();
    eventBus.$emit(BusEvent.AuthenticationChange);
    this.$router.push("/about");
  }

  get version() {
    return typeof COMMIT_HASH === "string"
      ? `(#${COMMIT_HASH.substr(0, 6)})`
      : "";
  }

  appReload() {
    window.location.reload(true);
  }
}
</script>

<style>
body {
  font-size: calc(16px + 1vw);
}
a#homelink {
  color: white;
  text-decoration: none;
}
#version {
  font-size: 0.5em;
  font-family: monospace;
  color: #eee;
  margin-left: 1em;
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
@media (min-width: 600px) {
  #app-bar {
    position: relative !important;
    flex: none;
  }
  #app-content {
    padding: 0 0 12px !important;
  }
}
</style>
