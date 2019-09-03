<template>
  <v-flex xs11 sm10 class="vga-limit login text-center">
    <template v-if="singleUserMode">
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
    </template>
    <template v-else>
      <h4>Single user login is disabled</h4>
    </template>
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";
import eventBus, { BusEvent } from "@app/plugins/event-bus";
import { strict as assert } from "assert";
import config from "@shared/smartcharge-config";

@Component({
  components: {}
})
export default class Login extends Vue {
  password: string = "";
  get singleUserMode() {
    return config.SINGLE_USER !== "false";
  }

  async login() {
    // loading...
    eventBus.$emit(BusEvent.AlertClear);
    try {
      await apollo.loginWithPassword(this.password);
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
  mounted() {}
}
</script>

<style></style>
