<template>
  <div class="home">
    <div v-if="loading">
      <v-progress-circular indeterminate color="primary"></v-progress-circular>
    </div>
    <v-card>
      <v-list-item
        v-for="vehicle in vehicles"
        :key="vehicle.id"
        :disabled="!vehicleReady(vehicle)"
        two-line
        @click="selectVehicle(vehicle)"
      >
        <v-container fluid grid-list-md>
          <v-layout wrap>
            <v-flex xs4 sm6>
              <v-img max-height="100" contain :src="vehiclePicture(vehicle)" />
            </v-flex>
            <v-flex xs8 sm6>
              <v-list-item-content>
                <v-list-item-title>{{ vehicle.name }}</v-list-item-title>
                <v-list-item-subtitle class="text-lowercase">
                  {{ vehicle.status || "adding..." }}</v-list-item-subtitle
                >
              </v-list-item-content>
            </v-flex>
          </v-layout>
        </v-container>
      </v-list-item>
    </v-card>
    <v-card-actions class="justify-center">
      <router-link to="/add/vehicle">
        <v-btn text small color="primary">add vehicle</v-btn>
      </router-link>
    </v-card-actions>
  </div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";
import { Vehicle } from "@shared/gql-types";

@Component({ components: {} })
export default class Home extends Vue {
  loading?: boolean;
  vehicles?: Vehicle[];

  data() {
    return { loading: false, vehicles: undefined };
  }
  async mounted() {
    this.loading = true;
    this.vehicles = await apollo.getVehicles();
    this.loading = false;
  }

  vehicleReady(vehicle: Vehicle) {
    return (
      vehicle.batteryLevel > 0 || vehicle.odometer > 0 || vehicle.status !== ""
    );
  }
  vehiclePicture(_vehicle: Vehicle) {
    return "https://static-assets.tesla.com/configurator/compositor?&options=$W39B,$PPSB,$DV4W&view=STUD_3QTR&model=m3&size=400&bkba_opt=1&version=0.0.25";
  }
}
</script>
