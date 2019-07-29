<template>
  <v-list two-line :subheader="subheader !== undefined">
    <v-subheader v-if="subheader !== undefined">{{ subheader }}</v-subheader>
    <v-list-item
      v-for="vehicle in list"
      :key="vehicle.id"
      :disabled="vehicle.controlled"
      @click="$emit('click-select', vehicle)"
    >
      <v-list-item-content>
        <v-list-item-title>{{ vehicle.name }}</v-list-item-title>
        <v-list-item-subtitle>{{ vehicle.vin }}</v-list-item-subtitle>
      </v-list-item-content>
    </v-list-item>
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
