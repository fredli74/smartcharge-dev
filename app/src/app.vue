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
      <v-btn text @click="logout">logout</v-btn>
    </v-app-bar>
    <v-content>
      <v-container fluid>
        <v-layout justify-space-around>
          <v-flex xs12 sm11 md10>
            <v-alert v-model="error.show" type="error" prominent>{{
              error.message
            }}</v-alert>
            <v-alert v-model="warning.show" type="warning">{{
              warning.message
            }}</v-alert>
            <router-view></router-view>
          </v-flex>
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
  warning!: AlertMessage;
  error!: AlertMessage;
  data() {
    return {
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
    if (!apollo.authorized) {
      const token = localStorage.getItem("token");
      if (token !== null) {
        try {
          await apollo.loginWithToken(token);
        } catch (err) {
          if (err.networkError && err.networkError.statusCode === 401) {
            eventBus.$emit(
              "ALERT_WARNING",
              "Invalid access token, new login required"
            );
          } else {
            eventBus.$emit("ALERT_ERROR", err.message || err);
          }
        }
      }
    }
  }
  errorCaptured(err: Error, _vm: Vue, _info: string) {
    this.error.message = err.message || (err as any).toString();
    this.error.show = true;
    return false;
  }

  async logout() {
    await apollo.logout();
    this.$router.push("/login");
  }
}
</script>

<style>
a#homelink {
  color: white;
  text-decoration: none;
}
</style>
