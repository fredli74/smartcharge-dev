<template>
  <v-container>
    <div style="min-height: 270px">
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
            <v-icon style="margin-top: 54px; font-size: 60px" color="red darken-3">mdi-flash-off</v-icon>
          </v-col>
        </v-row>
      </template>
      <template v-if="chargeControl == 1">
        <v-row class="my-8">
          <v-col class="text-center">
            <img width="130" class="ml-2" src="/img/icons/android-chrome-192x192.png">
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
            />
          </v-col>
        </v-row>
        <v-row class="mt-n3" align="center" justify="center">
          <v-col v-if="!showDate" cols="auto">
            <v-menu
              ref="scheduleMenu"
              :close-on-content-click="false"
              top
              min-width="290px"
            >
              <template #activator="{ on }">
                <v-btn color="secondary" outlined v-on="on">
                  <v-icon left>mdi-calendar-plus</v-icon> Schedule
                </v-btn>
              </template>
              <datetime-popup
                :key="refreshKey"
                class="vdatetime-static"
                type="datetime"
                :datetime="pickerDateTime"
                :minute-step="10"
                :week-start="1"
                :min-datetime="nowLocal.plus({ minutes: 1 })"
                :max-datetime="nowLocal.plus({ months: 6 }).endOf(`month`)"
                :auto="true"
                :phrases="{ cancel: `CANCEL`, ok: `OK` }"
                @confirm="
                  refreshKey++;
                  $refs.scheduleMenu.isActive = false;
                  confirmDateTime($event);
                "
                @cancel="
                  refreshKey++;
                  $refs.scheduleMenu.isActive = false;
                "
              />
            </v-menu>
          </v-col>
          <template v-else>
            <v-col cols="auto">
              <v-menu
                ref="dateMenu"
                :close-on-content-click="false"
                top
                min-width="290px"
              >
                <template #activator="{ on }">
                  <v-btn depressed v-on="on">
                    <v-icon left>mdi-calendar</v-icon>{{ pickerDate }}
                  </v-btn>
                </template>
                <datetime-popup
                  :key="refreshKey"
                  class="vdatetime-static"
                  type="date"
                  :datetime="pickerDateTime"
                  :week-start="1"
                  :min-datetime="nowLocal.plus({ minutes: 1 })"
                  :max-datetime="nowLocal.plus({ months: 6 }).endOf(`month`)"
                  :auto="true"
                  :phrases="{ cancel: `CANCEL`, ok: `SAVE` }"
                  @confirm="
                    refreshKey++;
                    $refs.dateMenu.isActive = false;
                    confirmDateTime($event);
                  "
                  @cancel="
                    refreshKey++;
                    $refs.dateMenu.isActive = false;
                  "
                />
              </v-menu>
            </v-col>
            <v-col cols="auto">
              <v-menu
                ref="timeMenu"
                :close-on-content-click="false"
                top
                min-width="290px"
              >
                <template #activator="{ on }">
                  <v-btn depressed @click="scrollFix" v-on="on">
                    <v-icon left class="mt-1">mdi-clock-end</v-icon>{{ pickerTime }}
                  </v-btn>
                </template>
                <datetime-popup
                  :key="refreshKey"
                  ref="timePicker"
                  type="time"
                  class="vdatetime-static"
                  :datetime="pickerDateTime"
                  :minute-step="10"
                  :min-datetime="nowLocal.plus({ minutes: 1 })"
                  :max-datetime="nowLocal.plus({ months: 6 }).endOf(`month`)"
                  :auto="true"
                  :phrases="{ cancel: `CANCEL`, ok: `SAVE` }"
                  @confirm="
                    refreshKey++;
                    $refs.timeMenu.isActive = false;
                    confirmDateTime($event);
                  "
                  @cancel="
                    refreshKey++;
                    $refs.timeMenu.isActive = false;
                  "
                />
              </v-menu>
            </v-col>

            <v-col cols="auto">
              <v-hover v-slot="{ hover }">
                <v-btn
                  fab
                  small
                  depressed
                  :color="hover ? `error` : ``"
                  @click="removeSchedule"
                >
                  <v-icon>mdi-calendar-remove-outline</v-icon>
                </v-btn>
              </v-hover>
            </v-col>
          </template>
        </v-row>
      </template>
    </div>
    <div style="min-height: 40px" class="text-center title grey--text text--darken-2">
      <v-progress-circular
        v-if="saving"
        indeterminate
        color="grey darken-2"
      />
      <span v-else>{{ smartText }}</span>
    </div>
  </v-container>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import { GQLVehicle, GQLScheduleType, GQLSchedule } from "@shared/sc-schema";
import apollo from "@app/plugins/apollo";

import { DateTime } from "luxon";
import { relativeTime } from "@shared/utils";
import { scheduleMap, getVehicleLocationSettings } from "@shared/sc-utils";
import { DatetimePopup } from "vue-datetime";

@Component({ components: { DatetimePopup } })
export default class VehicleCharge extends Vue {
  @Prop({ type: Object, required: true }) declare readonly vehicle: GQLVehicle;

  saving!: boolean;
  chargeControl!: number;
  chargeLevel!: number;
  chargeDate!: string | null;
  scheduleMap!: Record<string, GQLSchedule>;
  directLevel!: number;
  smartText!: string;
  defaultTimestamp!: number;
  pickerDateTime!: DateTime;
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

  mounted() {}
  data() {
    return {
      refreshKey: 0,
      saving: undefined,
      chargeControl: 1,
      chargeLevel: undefined,
      chargeDate: undefined,
      directLevel: undefined,
      smartText: undefined,
      defaultTimestamp: undefined,
      pickerDateTime: undefined,
      minDate: this.minDate,
      maxDate: this.maxDate,
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

  get showDate(): boolean {
    return Boolean(this.chargeDate);
  }
  get pickerDate(): any {
    const rt = relativeTime(this.pickerDateTime.toJSDate());
    return rt.date;
  }
  get pickerTime(): any {
    const rt = relativeTime(this.pickerDateTime.toJSDate());
    return rt.time;
  }
  removeSchedule() {
    this.chargeDate = null;
    this.chargeControlChanged();
  }

  updateMinMax() {
    this.minDate = DateTime.utc().plus({ minutes: 1 }).toISO();
    this.maxDate = DateTime.utc().plus({ months: 6 }).endOf("month").toISO();
  }

  @Watch("vehicle", { deep: false, immediate: true })
  loadData() {
    // Create state
    const map = scheduleMap(this.vehicle.schedule);
    const manual = map[GQLScheduleType.Manual];
    const settings = getVehicleLocationSettings(this.vehicle);
    const state = {
      directLevel: settings.directLevel,
      chargeControl: !manual ? 1 : manual.level ? 2 : 0,
      chargeLevel: (manual && manual.level) || this.vehicle.maximumLevel,
      chargeDate: manual && manual.time,
    };

    // Make AI time default for the date time picker
    const ai = map[GQLScheduleType.AI];
    this.defaultTimestamp =
      Math.ceil(
        (ai && ai.time
          ? new Date(ai && ai.time).getTime()
          : Date.now() + 12 * 60 * 60e3) / 60e4
      ) * 60e4;

    // Update controllers if data was changed
    if (state.directLevel !== this.loadedState.directLevel) {
      this.directLevel = state.directLevel;
    }
    if (state.chargeControl !== this.loadedState.chargeControl) {
      this.chargeControl = state.chargeControl;
    }
    if (state.chargeLevel !== this.loadedState.chargeLevel) {
      this.chargeLevel = state.chargeLevel;
    }
    if (state.chargeDate !== this.loadedState.chargeDate) {
      this.chargeDate = state.chargeDate;
    }
    this.loadedState = state;

    if (this.chargeControl === 0) {
      // STOP
      if (this.vehicle.isConnected) {
        this.smartText = `Charging is disabled until you plug in next time`;
      } else {
        this.smartText = `Charging is disabled next time you plug in`;
      }
    }
    if (this.chargeControl === 1) {
      // SMART
      if (ai && ai.time) {
        const rt = relativeTime(new Date(ai.time));
        this.smartText = `Charging to ${ai.level}% before ${rt.time} ${rt.date}`;
      } else {
        this.smartText = ``;
      }
    }
    if (this.chargeControl === 2) {
      // START
      if (manual && manual.time) {
        const rt = relativeTime(new Date(manual.time));
        this.smartText = `Charging to ${this.chargeLevel}% before ${rt.time} ${rt.date}`;
      } else {
        this.smartText = `Direct charging to ${this.chargeLevel}%`;
      }
    }
  }

  @Watch("chargeDate", { immediate: true })
  onChargeDate() {
    this.pickerDateTime = this.chargeDate
      ? DateTime.fromISO(this.chargeDate).toLocal()
      : DateTime.fromMillis(this.defaultTimestamp);
  }

  confirmDateTime(datetime: DateTime) {
    let setDate;
    if (datetime < DateTime.utc()) {
      setDate = new Date(
        Math.ceil((Date.now() + 5 * 60e3) / 60e4) * 60e4
      ).toISOString();
    } else {
      setDate = datetime.toJSDate().toISOString();
    }
    if (setDate !== this.chargeDate) {
      this.chargeDate = setDate;
      this.chargeControlChanged();
    }
  }

  async chargeControl_onChange() {
    // console.debug("chargeControl_onChange");
    this.chargeControlChanged();
  }
  async chargeLevel_onEnd() {
    // console.debug("chargeLevel_onEnd");
    this.chargeControlChanged();
  }
  async chargeLevel_onClick() {
    // console.debug("chargeLevel_onClick");
    this.chargeControlChanged();
  }

  debounceTimer?: any;
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
            (this.chargeDate && new Date(this.chargeDate)) || null
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
.datetime-picker-menu {
  input {
    cursor: pointer;
    text-align: center;
  }
  .v-input__prepend-outer .v-icon {
    margin-top: 3px;
    font-size: 28px;
  }
}
</style>
