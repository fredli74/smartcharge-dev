<template>
  <v-container grid-list-lg class="px-6">
    <v-layout wrap>
      <v-flex xs12 sm8 offset-sm4>
        <v-switch
          v-model="trip"
          color="green"
          inset
          label="Schedule trip"
        ></v-switch>
      </v-flex>
    </v-layout>
    <template v-if="trip">
      <v-toolbar flat dense dark color="green darken-2">
        <v-toolbar-title>Start</v-toolbar-title><v-spacer />
        <v-toolbar-title>{{ tripTime }}</v-toolbar-title>
      </v-toolbar>
      <VueCtkDateTimePicker
        v-model="tripTime"
        format="YYYY-MM-DD HH:mm"
        color="#388E3C"
        no-button
        no-button-now
        no-header
        inline
        :min-date="minDate"
        minute-interval="10"
      ></VueCtkDateTimePicker>
      <v-layout wrap class="pt-9">
        <v-flex xs12 sm4>
          <label class="subtitle-1">Needed charge</label> </v-flex
        ><v-flex xs12 sm8>
          <v-slider
            v-model="tripLevel"
            thumb-label="always"
            color="green"
            track-color="green lighten-4"
            thumb-color="green"
            min="50"
            max="100"
            append-icon="mdi-battery-charging"
          ></v-slider>
        </v-flex>
      </v-layout>
    </template>
  </v-container>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import VueCtkDateTimePicker from "vue-ctk-date-time-picker";
import "vue-ctk-date-time-picker/dist/vue-ctk-date-time-picker.css";
import moment from "moment";
import { GQLVehicle, GQLSchedule } from "@shared/sc-schema";

const FORMAT = "YYYY-MM-DD HH:mm";

@Component({ components: { VueCtkDateTimePicker } })
export default class VehicleTrip extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: GQLVehicle;

  formData!: any;
  trip!: boolean;
  tripTime!: string;
  tripLevel!: number;

  mounted() {
    // TODO: move auto_port control to a provider specific option?
  }
  data() {
    // debugger;
    this.formData = {
      tripSchedule:
        (this.vehicle &&
          this.vehicle.tripSchedule &&
          /*ScheduleToJS*/ this.vehicle.tripSchedule) ||
        null
    };
    return {
      tripTime: moment(
        (this.vehicle &&
          this.vehicle.tripSchedule &&
          this.vehicle.tripSchedule.time) ||
          (Math.ceil(Date.now() / 3600e3) + 12) * 3600e3
      ).format(FORMAT),
      tripLevel:
        (this.vehicle &&
          this.vehicle.tripSchedule &&
          this.vehicle.tripSchedule.level) ||
        this.vehicle.maximumLevel ||
        90,
      trip: Boolean(
        this.vehicle && this.vehicle.tripSchedule && this.vehicle.tripSchedule
      )
    };
  }

  get minDate() {
    return moment().format("YYYY-MM-DD");
  }

  @Watch("trip")
  @Watch("tripTime")
  @Watch("tripLevel")
  onChange() {
    const shouldBe: GQLSchedule | null = this.trip
      ? {
          level: this.tripLevel,
          time: moment(this.tripTime).toDate()
        }
      : null;

    if (
      this.formData.tripSchedule !== shouldBe &&
      ((this.formData.tripSchedule && this.formData.tripSchedule.level) !==
        (shouldBe && shouldBe.level) ||
        (this.formData.tripSchedule &&
          this.formData.tripSchedule.time &&
          this.formData.tripSchedule.time.getTime()) !==
          (shouldBe && shouldBe.time && shouldBe.time.getTime()))
    ) {
      this.formData.tripSchedule = shouldBe;
      this.$emit("changed", 1000, this.formData);
    }
  }
}
</script>
<style></style>
