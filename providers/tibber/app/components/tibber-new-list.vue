<template>
  <v-list two-line :subheader="subheader !== undefined">
    <v-subheader v-if="subheader !== undefined">{{ subheader }}</v-subheader>
    <v-list-item
      v-for="home in list"
      :key="home.id"
      :disabled="home.controlled"
      @click="$emit('click-select', home)"
    >
      <v-list-item-content>
        <v-list-item-title>{{ home.name }}</v-list-item-title>
        <v-list-item-subtitle>{{ home.nickname }}</v-list-item-subtitle>
      </v-list-item-content>
    </v-list-item>
  </v-list>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import { TibberNewListEntry } from "../tibber.vue";

@Component
export default class TeslaNewHomeList extends Vue {
  @Prop({ required: true }) readonly list!: TibberNewListEntry[];
  @Prop({}) readonly subheader?: string;
}
</script>

<style></style>
