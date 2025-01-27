<template>
  <v-app
    :class="`page-${$route.name} ${
      $route.meta && $route.meta.class ? $route.meta.class : ''
    }`"
  >
    <v-app-bar id="app-bar" app flat color="secondary" dark>
      <v-btn
        v-if="authorized"
        v-visible="!($route.meta && $route.meta.root)"
        dark
        icon
        @click="$router.go(-1)"
      >
        <v-icon>mdi-chevron-left</v-icon>
      </v-btn>
      <v-spacer v-if="authorized" />
      <v-toolbar-title class="headline text-uppercase">
        <router-link id="homelink" to="/">
          <span>smartcharge.d</span>
          <span class="font-weight-light">ev</span>
        </router-link>
      </v-toolbar-title>
      <v-spacer />
      <v-menu v-if="authorized" bottom left offset-y>
        <template #activator="{ on }">
          <v-btn dark icon v-on="on">
            <v-icon>mdi-dots-vertical</v-icon>
          </v-btn>
        </template>
        <v-list>
          <v-list-item to="/settings">
            <v-list-item-title>Settings</v-list-item-title>
          </v-list-item>
          <v-list-item @click="appReload()">
            <v-list-item-content>
              <v-list-item-title>Reload</v-list-item-title>
              <v-list-item-subtitle>
                beta version {{ version }}
              </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
          <v-divider />
          <v-list-item v-if="help_url" :href="help_url" target="_blank">
            <v-list-item-title>Help</v-list-item-title>
          </v-list-item>
          <v-list-item @click="logout">
            <v-list-item-title>Sign out</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      <v-btn v-else color="primary" @click="login">
        <v-icon left>mdi-login</v-icon>
        sign in
      </v-btn>
    </v-app-bar>
    <v-main id="app-content">
      <template v-if="$route.meta && $route.meta.fullpage">
        <router-view />
      </template>
      <v-container v-else fluid class="mt-sm-6">
        <v-layout
          v-if="error.show || warning.show || info.show"
          row
          justify-space-around
          class="mb-sm-4"
        >
          <v-flex xs12 sm10 md8>
            <v-alert
              v-model="error.show"
              dismissible
              type="error"
              tile
              prominent
            >
              <span v-html="error.message"></span>
            </v-alert>
            <v-alert v-model="warning.show" dismissible type="warning" tile>
              <span v-html="warning.message"></span>
            </v-alert>
            <v-alert
              v-model="info.show"
              dismissible
              type="info"
              tile
              @input="closedInfo"
            >
              <span v-html="info.message"></span>
            </v-alert>
          </v-flex>
        </v-layout>
        <v-layout row justify-space-around>
          <router-view />
        </v-layout>
      </v-container>
    </v-main>
  </v-app>
</template>

<script lang="ts">
import { strict as assert } from "assert";

import { Component, Vue } from "vue-property-decorator";
import apollo from "./plugins/apollo.js";
import eventBus, { BusEvent } from "./plugins/event-bus.js";
import config from "@shared/smartcharge-config.js";
import auth from "./plugins/auth0.js";

import "vue-datetime/dist/vue-datetime.css";

declare let COMMIT_HASH: string;

interface AlertMessage {
  show: boolean;
  message: string | undefined;
}
@Component({})
export default class App extends Vue {
  authorized!: boolean;
  help_url!: string;
  info!: AlertMessage;
  warning!: AlertMessage;
  error!: AlertMessage;
  data() {
    const data = {
      authorized: apollo.authorized,
      help_url: config.HELP_URL,
      info: {
        show: Boolean(config.GLOBAL_INFO_MESSAGE),
        message: config.GLOBAL_INFO_MESSAGE,
      },
      warning: {
        show: Boolean(config.GLOBAL_WARNING_MESSAGE),
        message: config.GLOBAL_WARNING_MESSAGE,
      },
      error: {
        show: Boolean(config.GLOBAL_ERROR_MESSAGE),
        message: config.GLOBAL_ERROR_MESSAGE,
      },
    };

    // Logic for global messages
    const dismissed = localStorage.getItem(`dismissed_info`);
    if (dismissed !== null) {
      if (data.info.show && data.info.message === dismissed) {
        data.info.show = false;
      } else {
        localStorage.removeItem(`dismissed_info`);
      }
    }
    return data;
  }
  closedInfo() {
    assert(this.info.message !== undefined);
    localStorage.setItem(`dismissed_info`, this.info.message);
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
    window.location.reload();
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
body {
  -webkit-touch-callout: none !important;
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0);
}
.autosize {
  font-size: calc(16px + 1vw);
}
input,
textarea {
  -moz-user-select: text;
  -webkit-user-select: text;
  -ms-user-select: text;
  user-select: text;
}
.v-list-item--link:before {
  z-index: 1;
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
    padding: 0px 0 18px !important;
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
.v-alert {
  z-index: 1;
  a {
    color: unset !important;
  }
}
</style>
