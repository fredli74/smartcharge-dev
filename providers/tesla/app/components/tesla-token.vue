<template>
  <div>
    <p>Please enter a <b>refresh token</b> to continue</p>
    <v-text-field
      v-model="refresh_token_input"
      small
      grow
      label="Tesla API refresh token"
      hint="<a href='https://tesla-token.netlify.com/' target='_blank'>Get it here</a>"
      persistent-hint
      filled
    ></v-text-field>

    <v-card-actions class="justify-center">
      <v-btn
        color="primary"
        :disabled="!properToken || loading"
        :loading="loading"
        @click="newToken"
        >continue <v-icon right>mdi-chevron-right</v-icon></v-btn
      >
    </v-card-actions>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";
import eventBus from "@app/plugins/event-bus";

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
      this.refresh_token_input.match(/^[0-9a-f]{64}$/) !== null
    );
  }
  async newToken() {
    eventBus.$emit("ALERT_CLEAR");
    this.loading = true;
    try {
      const token = await apollo.providerMutate("tesla", {
        mutation: "refreshToken",
        refresh_token: this.refresh_token_input
      });
      this.$emit("token", token);
    } catch {
      eventBus.$emit(
        "ALERT_WARNING",
        "Unable to verify new Tesla API refresh token"
      );
    }
    this.loading = false;
  }
}
</script>

<style></style>
