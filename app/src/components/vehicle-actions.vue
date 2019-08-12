<template>
  <v-card-actions
    id="vehicle-actions"
    v-resize="onResize"
    class="justify-center"
  >
    <v-dialog
      v-model="dialogShow"
      :fullscreen="$vuetify.breakpoint.xsOnly"
      max-width="600"
    ><v-card>
      <v-toolbar dark color="primary">
        <v-btn icon dark @click="dialogShow = false">
          <v-icon>{{
            $vuetify.breakpoint.xsOnly ? "mdi-chevron-left" : "mdi-close"
          }}</v-icon>
        </v-btn>
        <v-toolbar-title>{{ dialogTitle }}</v-toolbar-title>
        <v-spacer></v-spacer>
        <v-progress-circular      indeterminate      color="white"    ></v-progress-circular>
      </v-toolbar>
      <component :is="dialogContent" :vehicle="vehicle" />
      </v-card>
    </v-dialog>

    <v-tooltip v-if="!isSleeping" top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          :small="smallButton"
          outlined
          fab
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
          :small="smallButton"
          outlined
          fab
          color=""
          :loading="wakeupLoading"
          v-on="on"
          @click="wakeupClick()"
          ><v-icon :large="!smallButton">mdi-sleep-off</v-icon></v-btn
        >
      </template>
      <span>Wake Up</span>
    </v-tooltip>
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          :small="smallButton"
          :outlined="!vehicle.climateControl"
          fab
          :color="vehicle.climateControl ? 'primary' : ''"
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
          :small="smallButton"
          outlined
          fab
          color=""
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
          :small="smallButton"
          outlined
          fab
          color=""
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
          :small="smallButton"
          outlined
          fab
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
import { strict as assert } from "assert";

import { Component, Vue, Prop } from "vue-property-decorator";
import { Vehicle, Action } from "@shared/gql-types";
import { gql } from "apollo-boost";
import { AgentAction } from "@providers/provider-agent";
import apollo from "@app/plugins/apollo";
import eventBus from "../plugins/event-bus";
import { delay } from "@shared/utils";
import { VueConstructor } from "vue";
import VehicleSettings from "./vehicle-settings.vue";

@Component({
  apollo: {
    $subscribe: {
      actions: {
        query: gql`
          subscription ActionSubscription(
            $providerName: String
            $targetID: ID
          ) {
            actionSubscription(
              providerName: $providerName
              targetID: $targetID
            ) {
              actionID
              targetID
              providerName
              action
              data
            }
          }
        `,
        variables() {
          return {
            targetID: this.$route.params.id
          };
        },
        result({ data }: any) {
          const action = data.actionSubscription as Action;
          assert(action.targetID === this.$route.params.id);
          console.debug(action);
          if (action.data.error) {
            // Only subscribing for errors to be honest, all other actions
            // are checked in other ways
            eventBus.$emit("ALERT_WARNING", action.data.error);
            if (action.action === AgentAction.Update) {
              this.$data.refreshLoading = false;
            }
            if (action.action === AgentAction.WakeUp) {
              this.$data.wakeupLoading = false;
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

  wakeupLoading!: boolean;
  refreshLoading!: boolean;
  hvacLoading!: boolean;
  smallButton!: boolean;
  dialogShow!: boolean;
  dialogContent?: VueConstructor<Vue>;
  dialogTitle?: string;

  data() {
    return {
      wakeupLoading: false,
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
    apollo.action(
      this.vehicle!.id,
      this.vehicle!.providerData.provider,
      AgentAction.Update
    );
    const was = this.vehicle!.updated;
    while (this.vehicle!.updated === was) {
      await delay(1000);
    }
    this.refreshLoading = false;
  }
  async wakeupClick() {
    this.wakeupLoading = true;
    apollo.action(
      this.vehicle!.id,
      this.vehicle!.providerData.provider,
      AgentAction.WakeUp
    );
    while (this.isSleeping) {
      await delay(1000);
    }
    this.wakeupLoading = false;
  }
  async hvacClick() {
    this.hvacLoading = true;
    const want = !this.vehicle!.climateControl;
    apollo.action(
      this.vehicle!.id,
      this.vehicle!.providerData.provider,
      AgentAction.ClimateControl,
      { enable: want }
    );
    while (this.vehicle!.climateControl !== want) {
      await delay(1000);
    }
    this.hvacLoading = false;
  }

  tripClick() {
    this.dialogShow = true;
    this.dialogTitle = "Trip";
    this.dialogContent = VehicleActions;
    return true;
  }
  pauseClick() {
    this.dialogShow = true;
    this.dialogTitle = "Pause";
    this.dialogContent = VehicleActions;
    return true;
  }
  settingsClick() {
    this.dialogShow = true;
    this.dialogTitle = "Settings";
    this.dialogContent = VehicleSettings;
    return true;
  }
}</script
><style></style>
