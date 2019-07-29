<template>
  <v-app>
    <v-app-bar app color="secondary" dark>
      <v-toolbar-title class="headline text-uppercase">
        <span>smartcharge.d</span>
        <span class="font-weight-light">ev</span>
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn text @click="logout">logout</v-btn>
    </v-app-bar>
    <v-content>
      <v-container fluid>
        <v-layout justify-space-around>
          <v-flex xs12 sm8>
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
import eventBus from "./plugins/eventBus";

class AlertMessage {
  show: boolean = false;
  message: string = "";
}
@Component({
  components: {},
  errorCaptured: (_err, _vm, _info) => alert("I have a broken child :(")
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

<style></style>
