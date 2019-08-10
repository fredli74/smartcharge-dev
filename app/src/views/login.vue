<template>
  <div class="login text-center">
    <h2>LOGIN</h2>
    <v-form id="login-form" @submit.prevent="login">
      <input
        v-show="false"
        type="text"
        name="username"
        autocomplete="username"
      />
      <v-text-field
        v-model="password"
        type="password"
        label="password"
        required
        autocomplete="current-password"
      ></v-text-field>
      <v-btn type="submit" form="login-form">login</v-btn>
    </v-form>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "../plugins/apollo";
import eventBus from "../plugins/event-bus";
import { strict as assert } from "assert";

@Component({
  components: {}
})
export default class Login extends Vue {
  password: string = "";
  async verify() {}
  async login() {
    // loading...
    eventBus.$emit("ALERT_CLEAR");
    try {
      await apollo.loginWithPassword(this.password);
      eventBus.$emit("AUTHENTICATION_CHANGED");
      assert(apollo.account);
      this.$router.push("/");
    } catch (err) {
      if (err.graphQLErrors) {
        for (const e of err.graphQLErrors) {
          if (e.extensions && e.extensions.code === "UNAUTHENTICATED") {
            eventBus.$emit("ALERT_WARNING", `invalid password`);
            return;
          }
        }
      }
      eventBus.$emit("ALERT_ERROR", err.message || err);
    }
  }
  mounted() {}
}
</script>

<style></style>
