<template>
  <v-card flat>
    <v-card-text>
      <v-switch
        v-model="pause"
        color="primary"
        inset
        label="Pause smart charging"
      ></v-switch>
      <template v-if="pause">
        <v-toolbar flat dense dark color="red darken-2">
          <v-toolbar-title>Paused until</v-toolbar-title><v-spacer />
          <v-toolbar-title>{{ pausedUntil }}</v-toolbar-title>
        </v-toolbar>
        <VueCtkDateTimePicker
          v-model="pausedUntil"
          format="YYYY-MM-DD HH:mm"
          color="#D32F2F"
          no-button-now
          no-header
          inline
          :min-date="minDate"
          minute-interval="5"
        ></VueCtkDateTimePicker>
      </template>
    </v-card-text>
  </v-card>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import { Vehicle } from "@server/gql/vehicle-type";
import VueCtkDateTimePicker from "vue-ctk-date-time-picker";
import "vue-ctk-date-time-picker/dist/vue-ctk-date-time-picker.css";
import moment from "moment";

const FORMAT = "YYYY-MM-DD HH:mm";

@Component({ components: { VueCtkDateTimePicker } })
export default class VehiclePause extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: Vehicle;

  formData: any = {};
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
      this.$emit("changed", 100, this.formData);
    }
  }
}</script
><style></style>
