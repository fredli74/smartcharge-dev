<template>
  <v-list two-line :subheader="subheader !== undefined">
    <v-subheader v-if="subheader !== undefined">{{ subheader }}</v-subheader>
    <v-list-tile
      v-for="vehicle in list"
      :key="vehicle.id"
      :disabled="vehicle.controlled"
      avatar
      @click="$emit('click-select', vehicle)"
    >
      <v-list-tile-content>
        <v-list-tile-title v-html="vehicle.name"></v-list-tile-title>
        <v-list-tile-sub-title v-html="vehicle.vin"></v-list-tile-sub-title>
      </v-list-tile-content>
    </v-list-tile>
  </v-list>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import { Vehicle } from "@shared/gql-types";

@Component
export default class TeslaNewVehicleList extends Vue {
  @Prop({ required: true }) readonly list!: Vehicle[];
  @Prop({}) readonly subheader?: string;
}
</script>

<style></style>
