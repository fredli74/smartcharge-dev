<template>
  <v-flex xs11 sm10 class="vga-limit login text-center">
    <template v-if="loading">
      <v-progress-circular indeterminate color="primary" />
    </template>
    <template v-else-if="singleUserMode">
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
        />
        <v-btn type="submit" form="login-form">login</v-btn>
      </v-form>
    </template>
    <template v-else>
      <h5>click sign in button to continue</h5>
    </template>
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import eventBus, { BusEvent } from "@app/plugins/event-bus.js";
import { strict as assert } from "assert";
import auth from "../plugins/auth0";

@Component({
  components: {},
})
export default class Login extends Vue {
  loading?: boolean;
  data() {
    return { loading: false };
  }

  password: string = "";
  get singleUserMode() {
    return this.$scConfig.SINGLE_USER;
  }

  async login() {
    eventBus.$emit(BusEvent.AlertClear);
    this.loading = true;
    try {
      await this.$scClient.loginWithPassword(this.password);
      eventBus.$emit(BusEvent.AuthenticationChange);
      assert(this.$scClient.account);
      window.location.href = "/";
    } catch (err: any) {
      if (err.graphQLErrors) {
        for (const e of err.graphQLErrors) {
          if (e.extensions && e.extensions.code === "UNAUTHENTICATED") {
            eventBus.$emit(
              BusEvent.AlertWarning,
              e.message || `invalid password`
            );
            return;
          }
        }
      }
      eventBus.$emit(BusEvent.AlertError, err.message || err);
    } finally {
      this.loading = false;
    }
  }
  async mounted() {
    if (!this.singleUserMode) {
      this.loading = true;
      try {
        const id = await auth.handleAuthentication();
        if (id) {
          await this.$scClient.loginWithIDToken(id);
          eventBus.$emit(BusEvent.AuthenticationChange);
          assert(this.$scClient.account);
          this.$router.push("/");
        }
      } catch (err: any) {
        if (err && err.graphQLErrors) {
          for (const e of err.graphQLErrors) {
            if (e.extensions && e.extensions.code === "UNAUTHENTICATED") {
              eventBus.$emit(
                BusEvent.AlertWarning,
                e.message || `invalid password`
              );
              return;
            }
          }
        }
        eventBus.$emit(BusEvent.AlertError, (err && err.messsage) || err);
      } finally {
        this.loading = false;
      }
    }
  }
}
</script>

<style></style>
