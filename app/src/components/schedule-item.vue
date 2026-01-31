<template>
  <div>
    <v-list-item class="my-2">
      <v-row align="center" justify="space-between" no-gutters>
        <v-col cols="6" sm="3" order="0" class="grey--text text--darken-2">
          <v-icon large class="mr-1" color="grey-darken-2" left>
            {{ scheduleIcon }}
          </v-icon>
          <div class="inline-middle">{{ schedule.type }}</div>
        </v-col>
        <v-col cols="6" sm="5" class order="2">
          <v-menu v-model="timeMenu" :close-on-content-click="false" top min-width="290px">
            <template #activator="{ on }">
              <v-btn depressed class="px-3" v-on="on">
                <v-icon left class="mt-1">{{ timeIcon }}</v-icon>
                {{ schedulePrettyDate }}
              </v-btn>
            </template>
            <datetime-popup
              :key="refreshKey"
              type="datetime"
              class="vdatetime-static"
              :datetime="scheduleDateTime"
              :minute-step="10"
              :min-datetime="nowLocal.plus({ minutes: 1 })"
              :max-datetime="nowLocal.plus({ months: 6 }).endOf(`month`)"
              :auto="true"
              :phrases="{ cancel: `CANCEL`, ok: `OK` }"
              @confirm="
                refreshKey++;
                timeMenu = false;
                setDateTime($event);
              "
              @cancel="
                refreshKey++;
                timeMenu = false;
              "
            />
          </v-menu>
        </v-col>
        <v-col cols="6" :sm="newSchedule ? '4' : '3'" class="text-right text-sm-left" order="3">
          <v-menu
            ref="levelMenu"
            v-model="levelMenu"
            :close-on-content-click="false"
            :close-on-click="!capturing"
            :min-width="$vuetify.breakpoint.xsOnly ? `90vw` : `400px`"
            top
          >
            <template #activator="{ on }">
              <v-btn depressed class="px-2" v-on="on">
                <v-icon left>mdi-lightning-bolt</v-icon>
                {{ schedule.level }}%
              </v-btn>
            </template>
            <v-card>
              <v-row>
                <v-col class="mx-4 mt-3 mb-n5">
                  <v-slider
                    v-model="levelSlider"
                    class="pt-8"
                    thumb-label="always"
                    :min="directLevel"
                    :max="100"
                    prepend-icon="mdi-battery-charging-30"
                    append-icon="mdi-battery-charging-100"
                    :color="
                      levelSlider > vehicle.maximumLevel ? 'deep-orange' : ''
                    "
                    :thumb-color="
                      levelSlider > vehicle.maximumLevel
                        ? 'deep-orange darken-2'
                        : ''
                    "
                    @start="capturing = true"
                    @end="stopCapture"
                  />
                </v-col>
              </v-row>
              <v-card-actions>
                <v-spacer />

                <v-btn text @click="cancelLevel">Cancel</v-btn>
                <v-btn color="primary" text @click="setLevel">Ok</v-btn>
              </v-card-actions>
            </v-card>
          </v-menu>
        </v-col>
        <v-col
          v-if="!newSchedule"
          cols="6"
          sm="1"
          order="1"
          order-sm="4"
          class="text-right"
        >
          <v-menu top left offset-y nudge-top="10">
            <template #activator="{ on }">
              <v-hover v-slot="{ hover }">
                <v-btn
                  :loading="isRemoving"
                  fab
                  small
                  depressed
                  :color="hover ? `error` : `transparent`"
                  v-on="on"
                >
                  <v-icon>mdi-calendar-remove-outline</v-icon>
                </v-btn>
              </v-hover>
            </template>
            <v-btn depressed color="error" @click="removeSchedule">
              <v-icon medium left>mdi-trash-can-outline</v-icon>Remove
            </v-btn>
          </v-menu>
        </v-col>

        <v-col v-if="newSchedule" cols="6" sm="12" order="1" order-sm="12">
          <v-card-actions class="px-0 py-2">
            <v-spacer />
            <v-btn text @click="$emit(`cancel`)">Cancel</v-btn>
            <v-btn :loading="isSaving" color="primary" text @click="addSchedule">Add</v-btn>
            <v-spacer class="d-none d-sm-flex" />
          </v-card-actions>
        </v-col>
      </v-row>
    </v-list-item>
    <v-progress-linear v-if="isSaving" height="2" indeterminate />
  </div>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import { GQLSchedule, GQLScheduleType, GQLVehicle } from "@shared/sc-schema.js";
import { DateTime } from "luxon";
import { DatetimePopup } from "vue-datetime";
import { relativeTime, getDefaultScheduleTime } from "@shared/utils.js";
import { getVehicleLocationSettings } from "@shared/sc-utils.js";

@Component({ components: { DatetimePopup } })
export default class ScheduleItem extends Vue {
  @Prop({ type: Object, required: true }) declare readonly schedule: GQLSchedule;
  @Prop({ type: Object, required: true }) declare readonly vehicle: GQLVehicle;
  @Prop({ type: Boolean, default: false }) declare readonly newSchedule: boolean;

  localSchedule!: GQLSchedule;
  refreshKey!: number; // workaround to reset date picker step
  timeMenu!: boolean;
  levelMenu!: boolean;
  capturing!: boolean;
  levelSlider!: number;

  isSaving!: boolean;
  isRemoving!: boolean;

  data() {
    return {
      localSchedule: { ...this.schedule },
      refreshKey: 0,
      timeMenu: false,
      levelMenu: false,
      capturing: false,
      levelSlider: this.schedule.level || this.vehicle.maximumLevel,

      isSaving: false,
      isRemoving: false,
    };
  }

  get nowLocal(): DateTime {
    return DateTime.local();
  }
  get scheduleDateTime(): DateTime {
    const dt =
      this.localSchedule.time ||
      new Date(getDefaultScheduleTime()).toISOString();
    return DateTime.fromISO(dt).toLocal();
  }
  stopCapture() {
    setTimeout(() => (this.capturing = false), 150);
  }
  cancelLevel() {
    this.levelSlider = this.localSchedule.level || this.vehicle.maximumLevel;
    this.levelMenu = false;
  }
  async setLevel() {
    this.localSchedule.level = this.levelSlider;
    this.levelMenu = false;
    if (!this.newSchedule) {
      await this.save();
    }
  }
  get directLevel(): number {
    const settings = getVehicleLocationSettings(this.vehicle);
    return settings.directLevel;
  }
  async setDateTime(datetime: DateTime) {
    const was = this.localSchedule.time;
    if (datetime < DateTime.utc()) {
      this.localSchedule.time = new Date(
        Math.ceil((Date.now() + 5 * 60e3) / 60e4) * 60e4
      ).toISOString();
    } else {
      this.localSchedule.time = datetime.toJSDate().toISOString();
    }
    if (this.localSchedule.time !== was && !this.newSchedule) {
      await this.save();
    }
  }

  async addSchedule() {
    this.isSaving = true;
    this.$emit(`add`, this.localSchedule, () => {
      this.isSaving = false;
    });
  }

  debounceTimer?: any;
  async save() {
    if (!this.localSchedule.id) return; // assert!?

    this.isSaving = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      await this.$scClient.updateSchedule(
        this.localSchedule.id,
        this.localSchedule.vehicleID,
        this.localSchedule.type,
        this.localSchedule.level,
        (this.localSchedule.time && new Date(this.localSchedule.time)) || null
      );
      this.isSaving = false;
    });
  }

  async removeSchedule() {
    this.isRemoving = true;
    await this.$scClient.removeSchedule(this.localSchedule.id, this.localSchedule.vehicleID);
    this.isRemoving = false;
  }

  get scheduleIcon(): string {
    switch (this.localSchedule.type) {
      case GQLScheduleType.Trip:
        return "mdi-road-variant";
      case GQLScheduleType.Manual:
        return "mdi-ev-station";
      default:
        return "mdi-alarm";
    }
  }
  get timeIcon(): string {
    switch (this.localSchedule.type) {
      case GQLScheduleType.Trip:
        return "mdi-clock-start";
      default:
        return "mdi-clock-end";
    }
  }
  get schedulePrettyDate(): string {
    if (this.localSchedule.time) {
      const rt = relativeTime(new Date(this.localSchedule.time));
      return rt.date + " - " + rt.time;
      // return DateTime.fromISO(this.localSchedule.time).toFormat("yyyy-MM-dd HH:mm");
    } else {
      return "N/A";
    }
  }
}
</script>
<style>
.inline-middle {
  display: inline-flex;
  vertical-align: middle;
  font-size: 1.1em;
}
</style>
