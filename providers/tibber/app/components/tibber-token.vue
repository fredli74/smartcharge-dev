<template>
  <div>
    <p>Please enter a <b>Personal Access Token</b> to continue</p>
    <v-text-field
      v-model="token_input"
      small
      grow
      label="Tibber Personal Access Token"
      hint="<a href='https://developer.tibber.com/settings/accesstoken' target='_blank'>Get it here</a>"
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
import eventBus from "@app/plugins/event-bus";
import { getHomes } from "../tibber-helper";
@Component({ components: {} })
export default class TibberTokenVue extends Vue {
  loading?: boolean;
  token_input?: string;
  data() {
    // data() hook for undefined values
    return {
      loading: false,
      token_input: ""
    };
  }
  get properToken(): boolean {
    return (
      this.token_input !== undefined &&
      this.token_input.match(/^[0-9a-f]{64}$/) !== null
    );
  }
  async newToken() {
    eventBus.$emit("ALERT_CLEAR");
    this.loading = true;
    try {
      await getHomes(this.token_input!);
      this.$emit("token", this.token_input);
    } catch {
      eventBus.$emit(
        "ALERT_WARNING",
        "Unable to verify Tibber Personal Access Token"
      );
    }
    this.loading = false;
  }
}
</script>

<style></style>
