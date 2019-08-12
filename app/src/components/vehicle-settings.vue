<template>
  <v-card>
     <v-container grid-list-lg class="px-6">
       <v-layout wrap>
    <v-flex xs12 sm4 align-self-center class="mt-n2">
      <label class="subtitle-1">Vehicle name</label>
      </v-flex><v-flex xs12 sm8>
<v-text-field v-model="vehicle.name" :rules="[(value) => value.length > 0 || 'Required']"></v-text-field>
      </v-flex>
      </v-layout>
        <v-layout wrap class="pb-6">
    <v-flex xs12 sm4 align-self-center class="mt-n2">
      <label class="subtitle-1">Smart charge focus</label>
      </v-flex><v-flex xs12 sm8 >
<v-btn-toggle
        active-class="selected-charge"
        color="primary"
        xs10
        label="hej"
        mandatory
      >
        <v-btn>Low Cost </v-btn>
        <v-btn>Balanced </v-btn>
        <v-btn>Full Charge </v-btn>
      </v-btn-toggle>
      </v-flex>
      </v-layout>
      <v-layout wrap class="">
    <v-flex xs12 sm4 class="pt-7">
      <label class="subtitle-1">Minimum charge</label>
      </v-flex><v-flex xs12 sm8  class="pt-7">
<v-slider v-model="vehicle.minimumLevel" thumb-label="always" min="10" max="90"
          
append-icon="mdi-battery-alert"
          ></v-slider>
      </v-flex>
      </v-layout>
            <v-layout wrap>
    <v-flex xs12 sm4 class="pt-7">
      <label class="subtitle-1">Maximum charge</label>
      </v-flex><v-flex xs12 sm8  class="pt-7">
<v-slider v-model="vehicle.maximumLevel" thumb-label="always" :min="vehicle.minimumLevel" max="100"
          
append-icon="mdi-battery-charging"
          ></v-slider>
      </v-flex>
      </v-layout>
      
            </v-layout>
            <v-layout wrap >
    <v-flex xs12 sm4>
      </v-flex><v-flex xs12 sm8>
 <v-switch color="primary" inset label="Auto open charge port" persistent-hint hint="Opens port if charging is needed" ></v-switch>
      </v-flex>
      </v-layout>
      
      </v-container>
 

  </v-card>
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

@Component({})
export default class VehicleSettings extends Vue {
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
}</script
><style>
.selected-charge {
  font-weight: bolder;
}
</style>
