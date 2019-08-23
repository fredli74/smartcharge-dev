<template>
  <v-card-actions
    id="vehicle-actions"
    v-resize="onResize"
    class="justify-center"
  >
    <v-dialog
      v-model="dialogShow"
      :fullscreen="$vuetify.breakpoint.xsOnly"
      max-width="600px"
      ><v-card>
        <v-toolbar flat dark color="primary">
          <v-btn icon @click="dialogShow = false">
            <v-icon>{{
              $vuetify.breakpoint.xsOnly ? "mdi-chevron-left" : "mdi-close"
            }}</v-icon>
          </v-btn>
          <v-toolbar-title>{{ dialogTitle }}</v-toolbar-title>
        </v-toolbar>
        <component
          :is="dialogContent"
          :vehicle="vehicle"
          @changed="queueSave"
        />
      </v-card>
    </v-dialog>

    <v-tooltip v-if="!isSleeping" top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          outlined
          color=""
          :loading="refreshLoading"
          v-on="on"
          @click="refreshClick()"
          ><v-icon :large="!smallButton">mdi-refresh</v-icon></v-btn
        >
      </template>
      <span>Update</span>
    </v-tooltip>
    <v-tooltip v-else top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          outlined
          color=""
          :loading="refreshLoading"
          v-on="on"
          @click="refreshClick()"
          ><v-icon :large="!smallButton">mdi-sleep-off</v-icon></v-btn
        >
      </template>
      <span>Wake Up</span>
    </v-tooltip>
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          :outlined="!vehicle.climateControl"
          :color="vehicle.climateControl ? 'success' : ''"
          :loading="hvacLoading"
          v-on="on"
          @click="hvacClick()"
          ><v-icon :large="!smallButton"
            >mdi-fan{{ vehicle.climateControl ? "" : "-off" }}</v-icon
          ></v-btn
        >
      </template>
      <span>Climate Control</span>
    </v-tooltip>
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          :outlined="!Boolean(vehicle.tripSchedule)"
          :color="Boolean(vehicle.tripSchedule) ? 'success' : ''"
          v-on="on"
          @click="tripClick()"
          ><v-icon :large="!smallButton">mdi-road-variant</v-icon></v-btn
        >
      </template>
      <span>Trip</span>
    </v-tooltip>
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          :outlined="!Boolean(vehicle.pausedUntil)"
          :color="Boolean(vehicle.pausedUntil) ? 'warning' : ''"
          v-on="on"
          @click="pauseClick()"
          ><v-icon :large="!smallButton">mdi-pause</v-icon></v-btn
        >
      </template>
      <span>Pause Smart Charging</span>
    </v-tooltip>
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          outlined
          color=""
          v-on="on"
          @click="settingsClick()"
          ><v-icon :large="!smallButton">mdi-settings</v-icon></v-btn
        >
      </template>
      <span>Settings</span>
    </v-tooltip>
  </v-card-actions>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import { gql } from "apollo-boost";
import { AgentAction } from "@providers/provider-agent";
import apollo from "@app/plugins/apollo";
import { delay } from "@shared/utils";
import { VueConstructor } from "vue";
import VehicleSettings from "./vehicle-settings.vue";
import eventBus, { BusEvent } from "@app/plugins/event-bus";
import deepmerge from "deepmerge";
import { Action, Vehicle } from "@server/gql/vehicle-type";
import VehiclePause from "./vehicle-pause.vue";
import VehicleTrip from "./vehicle-trip.vue";

@Component({
  components: {
    VehiclePause,
    VehicleTrip
  },
  apollo: {
    $subscribe: {
      actions: {
        query: gql`
          subscription ActionSubscription(
            $providerName: String
            $serviceID: ID
          ) {
            actionSubscription(
              providerName: $providerName
              serviceID: $serviceID
            ) {
              actionID
              serviceID
              providerName
              action
              data
            }
          }
        `,
        variables() {
          return {
            serviceID: this.$props.vehicle.serviceID
          };
        },
        result({ data }: any) {
          const action = data.actionSubscription as Action;
          if (action.data.id === this.$route.params.id && action.data.error) {
            // Only subscribing for errors to be honest, all other actions
            // are checked in other ways
            eventBus.$emit(BusEvent.AlertWarning, action.data.error);
            if (action.action === AgentAction.Refresh) {
              this.$data.refreshLoading = false;
            }
            if (action.action === AgentAction.ClimateControl) {
              this.$data.hvacLoading = false;
            }
          }
        }
      }
    }
  }
})
export default class VehicleActions extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: Vehicle;

  changed!: boolean;
  saving!: boolean;
  refreshLoading!: boolean;
  hvacLoading!: boolean;
  smallButton!: boolean;
  dialogShow!: boolean;
  dialogContent?: VueConstructor<Vue>;
  dialogTitle?: string;

  data() {
    return {
      saving: false,
      changed: false,
      refreshLoading: false,
      hvacLoading: false,
      smallButton: false,
      dialogShow: false,
      dialogContent: undefined,
      dialogTitle: undefined
    };
  }
  onResize() {
    this.smallButton = window.innerWidth > 600 && window.innerWidth < 960;
  }
  get isSleeping() {
    return (
      this.vehicle &&
      (this.vehicle!.status.toLowerCase() === "offline" ||
        this.vehicle!.status.toLowerCase() === "sleeping")
    );
  }

  async refreshClick() {
    this.refreshLoading = true;
    apollo.action(this.vehicle!.serviceID, AgentAction.Refresh, {
      id: this.vehicle!.id
    });
    const was = this.vehicle!.updated;
    while (this.vehicle!.updated === was) {
      await delay(1000);
    }
    this.refreshLoading = false;
  }
  async hvacClick() {
    this.hvacLoading = true;
    if (this.isSleeping) this.refreshLoading = true;
    const want = !this.vehicle!.climateControl;
    apollo.action(this.vehicle!.serviceID, AgentAction.ClimateControl, {
      id: this.vehicle!.id,
      enable: want
    });
    while (this.vehicle!.climateControl !== want) {
      await delay(1000);
    }
    this.refreshLoading = false;
    this.hvacLoading = false;
  }

  tripClick() {
    this.dialogShow = true;
    this.dialogTitle = "Trip";
    this.dialogContent = VehicleTrip;
    return true;
  }
  pauseClick() {
    this.dialogShow = true;
    this.dialogTitle = "Pause";
    this.dialogContent = VehiclePause;
    return true;
  }
  settingsClick() {
    this.dialogShow = true;
    this.dialogTitle = "Settings";
    this.dialogContent = VehicleSettings;
    return true;
  }

  saveTimer?: any;
  unsavedData?: any = {};
  queueSave(delay: number, data: any) {
    console.debug("Queue:", data);
    this.unsavedData = deepmerge(this.unsavedData, data);
    this.changed = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.save();
      this.saveTimer = undefined;
    }, delay);
  }
  async save() {
    console.debug("Save:", this.unsavedData);
    this.saving = true;
    this.changed = false;
    await apollo.updateVehicle({
      id: this.vehicle.id,
      ...this.unsavedData
    });
    this.saving = false;
  }
}</script
><style>
.time-picker-column-item-text {
  font-size: 18px !important;
}
.datepicker-day-text {
  font-size: 18px !important;
}
</style>
