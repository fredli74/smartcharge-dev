<template>
  <div class="login text-center">
    <h2>LOGIN!</h2>
    <form @submit.prevent="login">
      <input
        v-show="false"
        type="text"
        name="username"
        autocomplete="username"
      />
      <input
        v-model="password"
        type="password"
        name="password"
        autocomplete="current-password"
      />
      <button type="submit">login</button>
    </form>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "../plugins/apollo";
import eventBus from "../plugins/eventBus";

@Component({
  components: {}
})
export default class Login extends Vue {
  password: string = "";
  async verify() {}
  async login() {
    // loading...
    eventBus.$emit("ALERT_CLEAR");
    const result = await apollo.loginWithPassword(this.password);
    if (apollo.account) {
      this.$router.push("/");
    } else if (
      result.graphQLErrors &&
      result.graphQLErrors.length > 0 &&
      result.graphQLErrors[0].extensions.code === "AUTHENTICATION_FAILED"
    ) {
      eventBus.$emit("ALERT_WARNING", `invalid password`);
    } else {
      eventBus.$emit("ALERT_ERROR", result.message || result);
    }
  }
  mounted() {}
}
</script>

<style></style>
