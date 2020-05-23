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
          <v-col v-if="!showDate" cols="auto">
            <v-menu
              ref="scheduleMenu"
              :close-on-content-click="false"
              top
              min-width="290px"
            >
              <template v-slot:activator="{ on }">
                <v-btn color="secondary" outlined v-on="on">
                  <v-icon left>mdi-calendar-plus</v-icon> Schedule
                </v-btn>
              </template>
              <datetime-popup
                :key="refreshKey"
                class="vdatetime-static"
                type="datetime"
                :datetime="chargeDateTime"
                :minute-step="10"
                :week-start="1"
                :min-datetime="nowLocal.plus({ minutes: 1 })"
                :max-datetime="nowLocal.plus({ months: 6 }).endOf(`month`)"
                :auto="true"
                @confirm="
                  refreshKey++;
                  $refs.scheduleMenu.isActive = false;
                  confirmDateTime($event);
                "
                @cancel="
                  refreshKey++;
                  $refs.scheduleMenu.isActive = false;
                "
              >
              </datetime-popup>
            </v-menu>
          </v-col>
          <template v-else>
            <v-spacer></v-spacer>
            <v-col cols="3">
              <v-menu
                ref="dateMenu"
                :close-on-content-click="false"
                top
                min-width="290px"
              >
                <template v-slot:activator="{ on }">
                  <v-text-field
                    v-model="pickerDate"
                    class="datetime-picker-menu"
                    readonly
                    v-on="on"
                  ></v-text-field>
                </template>
                <datetime-popup
                  :key="refreshKey"
                  class="vdatetime-static"
                  type="date"
                  :datetime="chargeDateTime"
                  :week-start="1"
                  :min-datetime="nowLocal.plus({ minutes: 1 })"
                  :max-datetime="nowLocal.plus({ months: 6 }).endOf(`month`)"
                  :auto="true"
                  @confirm="
                    refreshKey++;
                    $refs.dateMenu.isActive = false;
                    confirmDateTime($event);
                  "
                  @cancel="
                    refreshKey++;
                    $refs.dateMenu.isActive = false;
                  "
                >
                </datetime-popup>
              </v-menu>
            </v-col>
            <v-col cols="2">
              <v-menu
                ref="timeMenu"
                :close-on-content-click="false"
                :return-value.sync="chargeDateTime"
                top
                min-width="290px"
              >
                <template v-slot:activator="{ on }">
                  <v-text-field
                    v-model="pickerTime"
                    class="datetime-picker-menu"
                    readonly
                    @click="scrollFix"
                    v-on="on"
                  ></v-text-field>
                </template>
                <datetime-popup
                  :key="refreshKey"
                  ref="timePicker"
                  type="time"
                  class="vdatetime-static"
                  :datetime="chargeDateTime"
                  :minute-step="10"
                  :min-datetime="nowLocal.plus({ minutes: 1 })"
                  :max-datetime="nowLocal.plus({ months: 6 }).endOf(`month`)"
                  :auto="true"
                  @confirm="
                    refreshKey++;
                    $refs.timeMenu.isActive = false;
                    confirmDateTime($event);
                  "
                  @cancel="
                    refreshKey++;
                    $refs.timeMenu.isActive = false;
                  "
                >
                </datetime-popup>
              </v-menu>
            </v-col>

            <v-col cols="auto">
              <v-tooltip top>
                <template v-slot:activator="{ on }">
                  <v-hover v-slot:default="{ hover }">
                    <v-btn
                      class="mt-3"
                      fab
                      small
                      icon
                      :color="hover ? `error` : ``"
                      v-on="on"
                      @click="removeSchedule"
                      ><v-icon>mdi-calendar-remove</v-icon></v-btn
                    ></v-hover
                  >
                </template>
                <span>Remove schedule</span>
              </v-tooltip>
            </v-col>
            <v-spacer></v-spacer>
          </template>
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

import { DateTime } from "luxon";
import { relativeTime, dateCeil } from "@shared/utils";
import { scheduleMap, getVehicleLocationSettings } from "@shared/sc-utils";
import { DatetimePopup } from "vue-datetime";

@Component({ components: { DatetimePopup } })
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

  refreshKey!: number; // workaround to reset date picker step

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
      refreshKey: 0,
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

  scrollFix() {
    setTimeout(() => {
      if (this.$refs.timePicker) {
        for (const e of document.getElementsByClassName(
          "vdatetime-time-picker__item--selected"
        )) {
          e.scrollIntoView();
        }
      }
    }, 150);
  }

  get nowLocal(): DateTime {
    return DateTime.local();
  }

  get chargeDateTime(): DateTime {
    console.debug("chargeDateTime getter");
    return DateTime.fromISO(this.chargeDate).toLocal();
  }
  set chargeDateTime(val: DateTime) {
    console.debug(`chargeDateTime setter ${typeof val}:${val}`);
  }

  confirmDateTime(datetime: DateTime) {
    this.showDate = true;
    const was = this.chargeDate;
    if (datetime < DateTime.utc()) {
      this.chargeDate = dateCeil(
        DateTime.utc()
          .plus({ minutes: 5 })
          .toJSDate(),
        10
      ).toISOString();
    } else {
      this.chargeDate = datetime.toJSDate().toISOString();
    }
    if (this.chargeDate !== was) {
      this.chargeControlChanged();
    }
  }
  get pickerDate(): any {
    const rt = relativeTime(new Date(this.chargeDate));
    return rt.date;
  }
  get pickerTime(): any {
    const rt = relativeTime(new Date(this.chargeDate));
    return rt.time;
  }
  removeSchedule() {
    this.showDate = false;
    this.chargeControlChanged();
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
        dateCeil(
          DateTime.utc()
            .plus({ hours: 12 })
            .toJSDate(),
          10
        ).toISOString(),
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
.full-screen-height {
  max-height: calc(100vh - 25px);
}
.datetime-picker-menu {
  input {
    cursor: pointer;
    text-align: center;
  }
  .v-input__prepend-outer {
    margin-right: 4px !important;
  }
  .v-input__prepend-outer .v-icon {
    font-size: 20px;
  }
}
</style>
