<template>
  <v-app>
    <v-app-bar id="app-bar" app flat color="secondary" dark>
      <v-btn
        v-if="authorized"
        v-visible="$route.meta.root !== true"
        dark
        icon
        @click="$router.go(-1)"
      >
        <v-icon>mdi-chevron-left</v-icon>
      </v-btn>
      <v-spacer v-if="authorized"></v-spacer>
      <v-toolbar-title class="headline text-uppercase">
        <router-link id="homelink" to="/">
          <span>smartcharge.d</span>
          <span class="font-weight-light">ev</span>
        </router-link>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-menu v-if="authorized" bottom left offset-y>
        <template v-slot:activator="{ on }">
          <v-btn dark icon v-on="on">
            <v-icon>mdi-dots-vertical</v-icon>
          </v-btn>
        </template>
        <v-list>
          <v-list-item to="/settings"
            ><v-list-item-title>Settings</v-list-item-title>
          </v-list-item>
          <v-list-item @click="appReload()">
            <v-list-item-content>
              <v-list-item-title>Reload</v-list-item-title>
              <v-list-item-subtitle
                >beta version {{ version }}</v-list-item-subtitle
              >
            </v-list-item-content>
          </v-list-item>
          <v-divider></v-divider>
          <v-list-item @click="logout">
            <v-list-item-title>Sign out</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-btn v-else color="primary" @click="login">
        <v-icon left>mdi-login</v-icon>
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
import auth from "./plugins/auth0";

import "vue-datetime/dist/vue-datetime.css";

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
      auth.login();
    }
  }
  async logout() {
    await apollo.logout();
    eventBus.$emit(BusEvent.AuthenticationChange);
    if (this.singleUserMode) {
      this.$router.push("/about");
    } else {
      auth.logout();
    }
  }
}
</script>

<style lang="scss">
.autosize {
  font-size: calc(16px + 1vw);
}
body * {
  -webkit-touch-callout: none; /* iOS Safari */
  -webkit-user-select: none; /* Safari */
  -khtml-user-select: none; /* Konqueror HTML */
  -moz-user-select: none; /* Firefox */
  -ms-user-select: none; /* Internet Explorer/Edge */
  user-select: none; /* Non-prefixed version, currently supported by Chrome and Opera */
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}
input,
textarea {
  -moz-user-select: text;
}
.v-list-item .v-list-item__title,
.v-list-item .v-list-item__subtitle {
  line-height: inherit;
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
.v-icon.mdi-menu-down {
  cursor: pointer;
}

.vdatetime-popup__header {
  background: #1976d2; /* Todo, use primary if I figure out how  =)  */
}
.vdatetime-popup.vdatetime-static {
  position: relative;
  top: unset;
  left: unset;
  transform: unset;
  width: unset;
  max-width: unset;
}
.vdatetime-time-picker__item:hover,
.vdatetime-month-picker__item:hover,
.vdatetime-year-picker__item:hover {
  font-size: 20px !important;
}
.vdatetime-time-picker__item--selected:hover,
.vdatetime-month-picker__item--selected:hover,
.vdatetime-year-picker__item--selected:hover {
  font-size: 32px !important;
}
.vdatetime-time-picker__item--selected {
  background: #d3e5f7;
}
.pointer input {
  cursor: pointer;
}
</style>
