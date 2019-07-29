<template>
  <div class="newtoken">
    <p>Please enter a <b>refresh token</b> to continue</p>
    <v-text-field
      v-model="refresh_token_input"
      small
      label="Tesla API refresh token"
      hint="<a href='/teslaToken.html' target='_blank'>Get it here</a>"
      persistent-hint
      box
    ></v-text-field>
    <v-btn
      color="primary"
      :disabled="!properToken"
      :loading="loading"
      @click="newToken"
      >continue <v-icon right>arrow_forward</v-icon></v-btn
    >
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";
import eventBus from "@app/plugins/eventBus";

@Component({ components: {} })
export default class TeslaTokenVue extends Vue {
  loading?: boolean;
  refresh_token_input?: string;
  data() {
    // data() hook for undefined values
    return {
      loading: false,
      refresh_token_input: ""
    };
  }
  get properToken(): boolean {
    console.debug(this.refresh_token_input);
    return (
      this.refresh_token_input !== undefined &&
      this.refresh_token_input.match(/[0-9a-f]{64}/) !== null
    );
  }
  async newToken() {
    try {
      const token = await apollo.providerMutate("tesla", {
        mutation: "refreshToken",
        refresh_token: this.refresh_token_input
      });
      this.$emit("token", token);
    } catch {
      eventBus.$emit("WARNING", "Unable to verify new Tesla API refresh token");
    }
  }
}
</script>

<style></style>
