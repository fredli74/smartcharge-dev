<template>
  <v-card flat>
    <v-container grid-list-lg class="px-6">
      <v-layout wrap>
        <v-flex xs12 sm4 align-self-center class="mt-n2">
          <label class="subtitle-1">Vehicle name</label> </v-flex
        ><v-flex xs12 sm8>
          <v-text-field
            v-model="name"
            :rules="[value => value.length > 0 || 'Required']"
          ></v-text-field>
        </v-flex>
      </v-layout>
      <v-layout wrap class="pb-6">
        <v-flex xs12 sm4 align-self-center class="mt-n2">
          <label class="subtitle-1">Smart charge focus</label> </v-flex
        ><v-flex xs12 sm8>
          <v-btn-toggle
            v-model="anxietyLevel"
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
          <label class="subtitle-1">Minimum charge</label> </v-flex
        ><v-flex xs12 sm8 class="pt-7">
          <v-slider
            v-model="minLevel"
            thumb-label="always"
            min="10"
            max="90"
            append-icon="mdi-battery-alert"
          ></v-slider>
        </v-flex>
      </v-layout>
      <v-layout wrap>
        <v-flex xs12 sm4 class="pt-7">
          <label class="subtitle-1">Maximum charge</label> </v-flex
        ><v-flex xs12 sm8 class="pt-7">
          <v-slider
            v-model="maxLevel"
            thumb-label="always"
            :min="minLevel"
            max="100"
            append-icon="mdi-battery-charging"
          ></v-slider>
        </v-flex>
      </v-layout>

      <v-layout wrap>
        <v-flex xs12 sm8 offset-sm4>
          <v-switch
            v-model="chargePort"
            color="primary"
            inset
            label="Auto charge port"
            persistent-hint
            hint="Open after parking if charge is needed"
          ></v-switch></v-flex
        ><v-flex xs12 sm8 offset-sm4
          ><v-switch
            v-model="climateControl"
            class="pb-4"
            color="primary"
            inset
            label="Trip Climate Control"
            persistent-hint
            hint="Turn on before scheduled trip"
          ></v-switch>
        </v-flex>
      </v-layout>
    </v-container>
  </v-card>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import { Vehicle } from "@server/gql/vehicle-type";

@Component({})
export default class VehicleSettings extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: Vehicle;

  formData: any = {};
  mounted() {
    // TODO: move auto_port control to a provider specific option?
  }
  data() {
    return {};
  }

  doChange() {
    if (
      typeof this.formData.name === "string" &&
      this.formData.name.length < 1
    ) {
      delete this.formData.name;
    }
    this.$emit("changed", 1500, this.formData);
    return true;
  }

  get name() {
    if (this.formData.name === undefined) {
      this.formData.name = this.vehicle.name;
    }
    return this.formData.name;
  }
  set name(value: string) {
    if (this.formData.name !== value) {
      this.formData.name = value;
      this.doChange();
    }
  }

  get anxietyLevel() {
    if (this.formData.anxietyLevel === undefined) {
      this.formData.anxietyLevel = this.vehicle.anxietyLevel;
    }
    return this.formData.anxietyLevel;
  }
  set anxietyLevel(value: number) {
    if (this.formData.anxietyLevel !== value) {
      this.formData.anxietyLevel = value;
      this.doChange();
    }
  }
  get minLevel() {
    if (this.formData.minimumLevel === undefined) {
      this.formData.minimumLevel = this.vehicle.minimumLevel;
    }
    return this.formData.minimumLevel;
  }
  set minLevel(value: number) {
    if (this.formData.minimumLevel !== value) {
      this.formData.minimumLevel = value;
      this.doChange();
    }
  }
  get maxLevel() {
    if (this.formData.maximumLevel === undefined) {
      this.formData.maximumLevel = this.vehicle.maximumLevel;
    }
    return this.formData.maximumLevel;
  }
  set maxLevel(value: number) {
    if (this.formData.maximumLevel !== value) {
      this.formData.maximumLevel = value;
      this.doChange();
    }
  }
  get chargePort() {
    if (
      !this.formData.providerData ||
      this.formData.providerData.auto_port === undefined
    ) {
      this.formData.providerData = {
        auto_port: Boolean(
          this.vehicle.providerData && this.vehicle.providerData.auto_port
        )
      };
    }
    return this.formData.providerData.auto_port;
  }
  set chargePort(value: boolean) {
    if (
      !this.formData.providerData ||
      this.formData.providerData.auto_port !== value
    ) {
      this.formData.providerData.auto_port = value;
      this.doChange();
    }
  }
  get climateControl() {
    if (
      !this.formData.providerData ||
      this.formData.providerData.auto_hvac === undefined
    ) {
      this.formData.providerData = {
        auto_hvac: Boolean(
          this.vehicle.providerData && this.vehicle.providerData.auto_hvac
        )
      };
    }
    return this.formData.providerData.auto_hvac;
  }
  set climateControl(value: boolean) {
    if (
      !this.formData.providerData ||
      this.formData.providerData.auto_hvac !== value
    ) {
      this.formData.providerData.auto_hvac = value;
      this.doChange();
    }
  }
}</script
><style>
.selected-charge {
  font-weight: bolder;
}
</style>
