<template>
  <v-container>
    <div style="min-height:270px">
      <v-row justify="center" class="my-4">
        <v-btn-toggle
          v-model="chargeControl"
          active-class="selected-charge"
          color="primary"
          label="charging"
          mandatory
          @change="chargeControlChanged"
        >
          <v-btn>Stop</v-btn>
          <v-btn>Smart Charge</v-btn>
          <v-btn>Start</v-btn>
        </v-btn-toggle>
      </v-row>
      <template v-if="chargeControl == 0">
        <v-row class="">
          <v-col class="text-center">
            <v-icon style="margin-top:54px; font-size:60px" color="red darken-3"
              >mdi-flash-off</v-icon
            >
          </v-col>
        </v-row>
      </template>
      <template v-if="chargeControl == 1">
        <v-row class="my-8">
          <v-col class="text-center">
            <img
              width="130"
              class="ml-2"
              src="/img/icons/android-chrome-192x192.png"
            />
          </v-col>
        </v-row>
      </template>

      <template v-if="chargeControl == 2">
        <v-row justify="space-around">
          <v-col cols="11" sm="10">
            <v-slider
              v-model="chargeLevel"
              class="pt-8"
              thumb-label="always"
              :min="directLevel"
              :max="100"
              prepend-icon="mdi-battery-charging-30"
              append-icon="mdi-battery-charging-100"
              :color="chargeLevel > vehicle.maximumLevel ? 'deep-orange' : ''"
              :thumb-color="
                chargeLevel > vehicle.maximumLevel ? 'deep-orange darken-2' : ''
              "
              @end="chargeControlChanged"
            >
            </v-slider> </v-col
        ></v-row>
        <v-row class="" justify="space-around">
          <v-col cols="10" sm="7">
            <v-switch v-model="showDate" inset :label="`Schedule`">
              <template v-slot:append>
                <Datetime
                  id="chargeDate"
                  v-model="chargeDate"
                  v-visible="showDate"
                  :title="`charge before`"
                  type="datetime"
                  auto
                  :relative="true"
                  :input-class="[
                    'primary--text text--darken-2 font-weight-medium'
                  ]"
                  :minute-step="10"
                  :format="`yyyy-MM-dd hh:mm`"
                  :min-datetime="minDate"
                  :max-datetime="maxDate"
                  @input="chargeControlChanged"
                >
                </Datetime>
              </template>
            </v-switch>
          </v-col>
        </v-row>
      </template>
    </div>
    <div
      style="min-height:40px"
      class="text-center title grey--text text--darken-2"
    >
      <v-progress-circular
        v-if="saving"
        indeterminate
        color="grey darken-2"
      ></v-progress-circular>
      <span v-else>{{ smartText }}</span>
    </div>
  </v-container>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import {
  GQLVehicle,
  GQLSchduleType,
  GQLScheduleInput,
  GQLSchedule
} from "@shared/sc-schema";
import apollo from "@app/plugins/apollo";

import Datetime from "./datetime.vue";
import "vue-datetime/dist/vue-datetime.css";
import { scheduleMap, getVehicleLocationSettings } from "../plugins/utils";
import { DateTime } from "luxon";
import { relativeTime } from "@shared/utils";

@Component({ components: { Datetime } })
export default class VehicleCharge extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: GQLVehicle;

  saving!: boolean;
  chargeControl!: number;
  chargeLevel!: number;
  showDate!: boolean;
  chargeDate!: string;
  scheduleMap!: Record<string, GQLSchedule>;
  directLevel!: number;
  smartText!: string;

  created() {}
  mounted() {
    // TODO: move auto_port control to a provider specific option?
  }
  data() {
    return {
      saving: undefined,
      chargeControl: 1,
      chargeLevel: undefined,
      showDate: undefined,
      chargeDate: undefined,
      directLevel: undefined,
      smartText: undefined
    };
  }

  @Watch("showDate")
  onDateSwitch(val: boolean, old: boolean) {
    if (old !== undefined && val !== old) {
      this.chargeControlChanged();
    }
  }

  @Watch("vehicle", { deep: false, immediate: true })
  loadData() {
    this.scheduleMap = scheduleMap(this.vehicle.schedule);
    const manual = this.scheduleMap[GQLSchduleType.Manual];
    const settings = getVehicleLocationSettings(this.vehicle);

    this.directLevel = settings.directLevel;

    this.chargeControl = !manual ? 1 : manual.level === 0 ? 0 : 2;
    this.chargeLevel = (manual && manual.level) || this.vehicle.maximumLevel;
    this.showDate = !!(manual && manual.time);
    this.chargeDate =
      this.chargeDate ||
      new Date((Math.ceil(Date.now() / 60e4) + 12 * 6) * 60e4).toISOString();

    switch (this.chargeControl) {
      case 0: // STOP
        this.smartText = `Charging is disabled until next time you plug in`;
        break;
      case 1: // SMART
        {
          const ai = this.scheduleMap[GQLSchduleType.AI];
          if (ai && ai.time) {
            const rt = relativeTime(ai.time);
            this.smartText = `${ai.level}% before ${rt.date} at ${rt.time}`;
          } else {
            this.smartText = ``;
          }
        }
        break;
      case 2: // START
        {
          if (manual.time) {
            this.chargeDate = manual.time.toISOString();
            const rt = relativeTime(manual.time);
            this.smartText = `Charging to ${this.chargeLevel}% before ${rt.date} at ${rt.time}`;
          } else {
            this.smartText = `Direct charging to ${this.chargeLevel}%`;
          }
        }
        break;
    }
  }

  relTime(dt: DateTime) {
    const rt = relativeTime(dt.toJSDate());
    return rt.date + " - " + rt.time;
  }

  get minDate() {
    return DateTime.utc()
      .plus({ minutes: 1 })
      .toISO();
  }
  get maxDate() {
    return DateTime.utc()
      .plus({ months: 6 })
      .endOf("month")
      .toISO();
  }

  async chargeControlChanged() {
    // Replace all Charge and Manual events
    const was: GQLScheduleInput[] = this.vehicle.schedule.filter(
      f => f.type === GQLSchduleType.Manual
    );
    switch (this.chargeControl) {
      case 0: // STOP
        this.saving = true;
        await apollo.replaceVehicleSchedule(this.vehicle.id, was, [
          { type: GQLSchduleType.Manual, level: 0 }
        ]);
        this.saving = false;
        break;
      case 1: // SMART
        this.saving = true;
        await apollo.replaceVehicleSchedule(this.vehicle.id, was, []);
        this.saving = false;
        break;
      case 2: // START
        this.saving = true;
        await apollo.replaceVehicleSchedule(this.vehicle.id, was, [
          {
            type: GQLSchduleType.Manual,
            level: this.chargeLevel,
            time: this.showDate ? new Date(this.chargeDate) : undefined
          }
        ]);
        this.saving = false;
        break;
    }
  }
}
</script>
<style lang="scss">
.selected-charge {
  font-weight: bolder !important;
}
#chargeDate {
  font-size: 17px;
  input {
    text-align: right;
  }
}
</style>
