<template>
  <v-container class="px-0 py-0">
    <v-list>
      <ScheduleItem
        v-if="newSchedule"
        key="new"
        class="new-schedule pb-2 pb-sm-0 pt-sm-3"
        :schedule="newSchedule"
        :vehicle="vehicle"
        :new-schedule="true"
        @cancel="newSchedule = undefined"
        @add="addSchedule"
      />
      <v-list-item v-else>
        <v-spacer />
        <v-btn outlined @click="addTrip">
          <v-icon left>mdi-plus</v-icon>add trip
        </v-btn><v-spacer />
      </v-list-item>

      <template v-for="(schedule, index) in schedule">
        <v-divider v-if="index > 0" :key="index" />
        <ScheduleItem
          :key="schedule.id"
          :schedule="schedule"
          :vehicle="vehicle"
        />
      </template>
    </v-list>
  </v-container>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import { DateTime } from "luxon";
import { GQLVehicle, GQLSchedule, GQLScheduleType } from "@shared/sc-schema.js";
import { getDefaultScheduleTime } from "@shared/utils.js";
import ScheduleItem from "./schedule-item.vue";

@Component({ components: { ScheduleItem } })
export default class VehicleSchedule extends Vue {
  @Prop({ type: Object, required: true }) declare readonly vehicle: GQLVehicle;

  formData!: any;
  trip!: boolean;
  tripTime!: string;
  tripLevel!: number;

  newSchedule?: Partial<GQLSchedule>;

  guideDateTime!: DateTime;
  schedule?: GQLSchedule[];

  mounted() {}

  data() {
    return {
      schedule: undefined,
      guideDateTime: DateTime.fromMillis(getDefaultScheduleTime()),
      newSchedule: undefined,
    };
  }

  @Watch("vehicle.schedule", { immediate: true })
  onChangeSchedule() {
    this.schedule = this.vehicle.schedule.filter((f) => {
      if (!f.level) return false;
      if (!f.time) return false;
      if (f.type === GQLScheduleType.Trip) return true;
      if (f.type === GQLScheduleType.Manual) return true;
      if (f.type === GQLScheduleType.AI) {
        this.guideDateTime = DateTime.fromMillis(
          Math.ceil(new Date(f.time).getTime() / 60e4) * 60e4
        );
      }
      return false;
    });
  }

  addTrip() {
    this.newSchedule = {
      vehicleID: this.vehicle.id,
      type: GQLScheduleType.Trip,
      level: this.vehicle.maximumLevel,
      time: this.guideDateTime.toISO(),
    };
  }

  async addSchedule(localSchedule: Partial<GQLSchedule>, callback: any) {
    if (localSchedule && localSchedule.type) {
      const lvl = localSchedule.level || null;
      const time =
        (localSchedule.time && new Date(localSchedule.time)) || null;

      await this.$scClient.updateSchedule(
        undefined,
        this.vehicle.id,
        localSchedule.type,
        lvl,
        time
      );
    }

    if (typeof callback === "function") callback();
    this.newSchedule = undefined;
  }
}
</script>
<style>
.new-schedule {
  border: 2px dashed #bdaf00;
}
</style>
