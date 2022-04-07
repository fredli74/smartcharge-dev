<template>
  <div>
    <p>Please paste your <b>refresh token</b> to continue</p>
    <v-textarea
      v-model="refresh_token_input"
      auto-grow
      autofocus
      flat
      filled
      label="Tesla refresh token"
      hint="Get it here"
      persistent-hint
      counter
      ><template #message="{ message, key }">
        <a
          :key="key"
          href="https://tesla-token.netlify.com/#refresh_token"
          target="_blank"
          >{{ message }}</a
        >
      </template>
    </v-textarea>

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
import eventBus, { BusEvent } from "@app/plugins/event-bus";
import { TeslaProviderMutates } from "../..";

@Component({ components: {} })
export default class TeslaTokenVue extends Vue {
  loading?: boolean;
  refresh_token_input?: string;
  data() {
    // data() hook for undefined values
    return {
      loading: false,
      refresh_token_input: "",
    };
  }
  get properToken(): boolean {
    return (
      this.refresh_token_input !== undefined &&
      this.refresh_token_input.match(/^\S{800}/) !== null
    );
  }
  async newToken() {
    eventBus.$emit(BusEvent.AlertClear);
    this.loading = true;
    try {
      const token = await apollo.providerMutate("tesla", {
        mutation: TeslaProviderMutates.RefreshToken,
        refresh_token: this.refresh_token_input,
      });
      this.$emit("token", token);
    } catch {
      eventBus.$emit(
        BusEvent.AlertWarning,
        "Unable to verify new Tesla API refresh token"
      );
    }
    this.loading = false;
  }
}
</script>

<style></style>
