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
          @change="chargeControl_onChange"
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
              @end="chargeLevel_onEnd"
              @click="chargeLevel_onClick"
            >
            </v-slider> </v-col
        ></v-row>
        <v-row class="mt-n3" justify="space-around">
          <v-col cols="10" sm="7">
            <v-switch
              v-model="showDate"
              inset
              :label="`Schedule`"
              @change="onChangeShowDate"
            >
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
                  :format="`yyyy-MM-dd HH:mm`"
                  :min-datetime="minDate"
                  :max-datetime="maxDate"
                  @input="chargeDate_onInput"
                  @confirm="chargeDate_onConfirm"
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
import { GQLVehicle, GQLScheduleType, GQLSchedule } from "@shared/sc-schema";
import apollo from "@app/plugins/apollo";

import Datetime from "./datetime.vue";
import "vue-datetime/dist/vue-datetime.css";
import { DateTime } from "luxon";
import { relativeTime } from "@shared/utils";
import { scheduleMap, getVehicleLocationSettings } from "@shared/sc-utils";

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
  minDate!: string;
  maxDate!: string;

  loadedState: any = {};

  timer?: any;
  async created() {
    this.updateMinMax(); // first time
    this.timer = setInterval(() => {
      this.updateMinMax(); // every time
    }, 30e3);
  }
  beforeDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

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
      smartText: undefined,
      minDate: this.minDate,
      maxDate: this.maxDate
    };
  }

  updateMinMax() {
    this.minDate = DateTime.utc()
      .plus({ minutes: 1 })
      .toISO();
    this.maxDate = DateTime.utc()
      .plus({ months: 6 })
      .endOf("month")
      .toISO();
  }

  onChangeShowDate() {
    console.debug("onChangeShowDate");
    this.chargeControlChanged();
  }

  stateToControllers(v: GQLVehicle): any {
    const map = scheduleMap(v.schedule);
    const manual = map[GQLScheduleType.Manual];
    const settings = getVehicleLocationSettings(v);

    return {
      directLevel: settings.directLevel,
      chargeControl: !manual ? 1 : manual.level ? 2 : 0,
      chargeLevel: (manual && manual.level) || this.vehicle.maximumLevel,
      showDate: !!(manual && manual.time),
      chargeDate:
        (manual && manual.time) ||
        new Date((Math.ceil(Date.now() / 60e4) + 12 * 6) * 60e4).toISOString(),
      map
    };
  }

  @Watch("vehicle", { deep: false, immediate: true })
  loadData() {
    const state = this.stateToControllers(this.vehicle);

    if (state.directLevel !== this.loadedState.directLevel) {
      this.directLevel = state.directLevel;
    }
    if (state.chargeControl !== this.loadedState.chargeControl) {
      this.chargeControl = state.chargeControl;
    }
    if (state.chargeLevel !== this.loadedState.chargeLevel) {
      this.chargeLevel = state.chargeLevel;
    }
    if (state.showDate !== this.loadedState.showDate) {
      this.showDate = state.showDate;
    }
    if (state.chargeDate !== this.loadedState.chargeDate) {
      this.chargeDate = state.chargeDate;
    }
    this.loadedState = state;

    if (this.chargeControl === 0) {
      // STOP
      this.smartText = `Charging is disabled until next time you plug in`;
    }
    if (this.chargeControl === 1) {
      // SMART
      const ai = state.map[GQLScheduleType.AI];
      if (ai && ai.time) {
        const rt = relativeTime(new Date(ai.time));
        this.smartText = `Charging to ${ai.level}% before ${rt.time} ${rt.date}`;
      } else {
        this.smartText = ``;
      }
    }
    if (this.chargeControl === 2) {
      const manual = state.map[GQLScheduleType.Manual];
      // START
      if (manual && manual.time) {
        const rt = relativeTime(new Date(manual.time));
        this.smartText = `Charging to ${this.chargeLevel}% before ${rt.time} ${rt.date}`;
      } else {
        this.smartText = `Direct charging to ${this.chargeLevel}%`;
      }
    }
  }

  relTime(dt: DateTime) {
    const rt = relativeTime(dt.toJSDate());
    return rt.date + " - " + rt.time;
  }

  debounceTimer?: any;
  async chargeControl_onChange() {
    console.debug("chargeControl_onChange");
    this.chargeControlChanged();
  }
  async chargeLevel_onEnd() {
    console.debug("chargeLevel_onEnd");
    this.chargeControlChanged();
  }
  async chargeLevel_onClick() {
    console.debug("chargeLevel_onClick");
    this.chargeControlChanged();
  }
  async chargeDate_onInput() {
    console.debug("chargeDate_onInput");
  }
  async chargeDate_onConfirm() {
    console.debug("chargeDate_onConfirm");
    this.chargeControlChanged();
  }

  async chargeControlChanged() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      // Replace all Charge and Manual events
      let scheduleID: number | undefined;
      const remove = [];
      for (const s of this.vehicle.schedule) {
        if (s.type === GQLScheduleType.Manual) {
          if (scheduleID === undefined) {
            scheduleID = s.id;
          } else {
            remove.push(apollo.removeSchedule(s.id, this.vehicle.id));
          }
        }
      }
      await Promise.all(remove);

      switch (this.chargeControl) {
        case 0: // STOP
          this.saving = true;
          await apollo.updateSchedule(
            scheduleID,
            this.vehicle.id,
            GQLScheduleType.Manual,
            null,
            null
          );
          this.saving = false;
          break;
        case 1: // SMART
          this.saving = true;
          if (scheduleID) {
            await apollo.removeSchedule(scheduleID, this.vehicle.id);
          }
          this.saving = false;
          break;
        case 2: // START
          this.saving = true;
          await apollo.updateSchedule(
            scheduleID,
            this.vehicle.id,
            GQLScheduleType.Manual,
            this.chargeLevel,
            this.showDate ? new Date(this.chargeDate) : null
          );
          this.saving = false;
          break;
      }
    }, 800);
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
