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
      <v-btn v-if="authorized" text @click="logout">sign out</v-btn>
      <v-btn v-else color="primary" @click="login">
        <v-icon left>{{ singleUserMode ? "mdi-login" : "mdi-google" }}</v-icon>
        sign in</v-btn
      >
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
import config from "@shared/smartcharge-config";
import { strict as assert } from "assert";

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

  get version() {
    return typeof COMMIT_HASH === "string"
      ? `(#${COMMIT_HASH.substr(0, 6)})`
      : "";
  }

  appReload() {
    window.location.reload(true);
  }

  get singleUserMode() {
    return config.SINGLE_USER !== "false";
  }

  async login() {
    if (this.singleUserMode) {
      this.$router.push("/login");
    } else {
      try {
        const GoogleUser = await (this as any).$gAuth.signIn();
        await apollo.loginWithGoogle(GoogleUser.getAuthResponse().id_token);
        eventBus.$emit(BusEvent.AuthenticationChange);
        assert(apollo.account);
        this.$router.push("/");
      } catch (err) {
        if (err.graphQLErrors) {
          for (const e of err.graphQLErrors) {
            if (e.extensions && e.extensions.code === "UNAUTHENTICATED") {
              eventBus.$emit(BusEvent.AlertWarning, `invalid password`);
              return;
            }
          }
        }
        eventBus.$emit(BusEvent.AlertError, err.message || err);
      }
    }
  }
  async logout() {
    await apollo.logout();
    eventBus.$emit(BusEvent.AuthenticationChange);
    this.$router.push("/about");
  }
}
</script>

<style>
body {
  font-size: calc(16px + 1vw);
  -webkit-touch-callout: none; /* iOS Safari */
  -webkit-user-select: none; /* Safari */
  -khtml-user-select: none; /* Konqueror HTML */
  -moz-user-select: none; /* Firefox */
  -ms-user-select: none; /* Internet Explorer/Edge */
  user-select: none; /* Non-prefixed version, currently supported by Chrome and Opera */
}
input,
textarea {
  -moz-user-select: text;
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
