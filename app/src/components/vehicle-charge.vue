<template>
  <v-container grid-list-lg class="px-6">
    <v-layout wrap>
      <v-flex xs12 sm8 offset-sm4>
        <v-switch
          v-model="pause"
          color="red"
          inset
          label="Pause smart charging"
        ></v-switch>
      </v-flex>
    </v-layout>

    <template v-if="pause">
      <v-toolbar flat dense dark color="red darken-2">
        <v-toolbar-title>Until</v-toolbar-title><v-spacer />
        <v-toolbar-title>{{ pausedUntil }}</v-toolbar-title>
      </v-toolbar>
      <VueCtkDateTimePicker
        v-model="pausedUntil"
        format="YYYY-MM-DD HH:mm"
        color="#D32F2F"
        no-button
        no-button-now
        no-header
        inline
        :min-date="minDate"
        minute-interval="10"
      ></VueCtkDateTimePicker>
    </template>
  </v-container>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import VueCtkDateTimePicker from "vue-ctk-date-time-picker";
import "vue-ctk-date-time-picker/dist/vue-ctk-date-time-picker.css";
import moment from "moment";
import { GQLVehicle } from "@shared/sc-schema";

const FORMAT = "YYYY-MM-DD HH:mm";

@Component({ components: { VueCtkDateTimePicker } })
export default class VehicleCharge extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: GQLVehicle;

  formData!: any;
  pause!: boolean;
  pausedUntil!: string;

  mounted() {
    // TODO: move auto_port control to a provider specific option?
  }
  data() {
    this.formData = {
      pausedUntil: (this.vehicle && this.vehicle.pausedUntil) || null
    };
    return {
      pausedUntil: moment(
        (this.vehicle && this.vehicle.pausedUntil) ||
          (Math.ceil(Date.now() / 60e4) + 24 * 6) * 60e4
      ).format(FORMAT),
      pause: Boolean(this.vehicle && this.vehicle.pausedUntil)
    };
  }

  get minDate() {
    return moment()
      .add(1, "minute")
      .format(FORMAT);
  }

  @Watch("pause")
  @Watch("pausedUntil")
  onChange() {
    const shouldBe = this.pause ? moment(this.pausedUntil).toDate() : null;

    if (this.formData.pausedUntil !== shouldBe) {
      this.formData.pausedUntil = shouldBe;
      this.$emit("changed", 1000, this.formData);
    }
  }
}
</script>
<style></style>
