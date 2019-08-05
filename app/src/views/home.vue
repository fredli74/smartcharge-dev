<template>
  <div class="home">
    <div v-if="loading">
      <v-progress-linear indeterminate color="primary"></v-progress-linear>
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
          <v-layout align-center justify-space-around>
            <v-flex xs4 sm5>
              <v-img max-height="100" contain :src="vehiclePicture(vehicle)" />
            </v-flex>
            <v-flex xs7 sm6>
              <v-list-item-content>
                <v-list-item-title>{{ vehicle.name }}</v-list-item-title>
                <v-list-item-subtitle class="text-lowercase">
                  {{ vehicle.status || "adding..." }}</v-list-item-subtitle
                >
              </v-list-item-content>
            </v-flex>
            <v-flex xs1>
              <v-progress-circular
                :rotate="90"
                :size="40"
                :width="3"
                :value="vehicle.batteryLevel"
                :color="
                  vehicle.batteryLevel > 20
                    ? 'green'
                    : vehicle.batteryLevel > 10
                    ? 'orange'
                    : 'red'
                "
                class="caption"
              >
                {{ vehicle.batteryLevel }}%
              </v-progress-circular>
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
import { Vehicle } from "@shared/gql-types";
import { gql } from "apollo-boost";
import providers from "@providers/provider-apps";

@Component({
  components: {},
  apollo: {
    vehicles: {
      query: gql`
        query GetVehicles {
          vehicles {
            id
            name
            batteryLevel
            status
            providerData
          }
        }
      `,
      //update: data => data.vehicles,
      watchLoading(isLoading, _countModifier) {
        this.loading = isLoading;
      },
      pollInterval: 5000
    }
  }
})
export default class Home extends Vue {
  loading?: boolean;
  vehicles?: Vehicle[];

  data() {
    return { loading: false, vehicles: undefined };
  }
  async mounted() {
    // this.loading = true;
    // this.vehicles = await apollo.getVehicles();
    // this.loading = false;
  }

  vehicleReady(vehicle: Vehicle) {
    return (
      vehicle.batteryLevel > 0 || vehicle.odometer > 0 || vehicle.status !== ""
    );
  }
  vehiclePicture(vehicle: Vehicle) {
    const provider = providers.find(
      p => p.name === vehicle.providerData.provider
    );
    if (provider && provider.image) {
      return provider.image(vehicle);
    } else {
      return "";
    }
  }
  selectVehicle(vehicle: Vehicle) {
    this.$router.push(`/vehicle/${vehicle.id}`);
  }
}
</script>
