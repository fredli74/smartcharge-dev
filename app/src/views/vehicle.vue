<template>
  <div class="vehicle">
    <div v-if="loading">
      <v-progress-linear indeterminate color="primary"></v-progress-linear>
    </div>
    <div v-if="vehicle !== undefined">
      <h2>{{ vehicle.name }}</h2>
      <h6>{{ vehicle.status }}</h6>
      <v-img contain :src="vehiclePicture(vehicle)" />
      <v-progress-linear
        :value="vehicle.batteryLevel"
        height="20"
        :color="
          vehicle.batteryLevel > 20
            ? 'green'
            : vehicle.batteryLevel > 10
            ? 'orange'
            : 'red'
        "
        >{{ vehicle.batteryLevel }}%</v-progress-linear
      >
      {{ vehicle.smartStatus }}
      {{ vehicle }}
    </div>
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
    vehicle: {
      query: gql`
        query GetVehicle($id: String!) {
          vehicle(id: $id) {
            id
            name
            location
            batteryLevel
            climateControl
            status
            smartStatus
            providerData
          }
        }
      `,
      variables() {
        return {
          id: this.$route.params.id
        };
      },
      //update: data => data.vehicles,
      watchLoading(isLoading, countModifier) {
        this.loading = isLoading;
      },
      pollInterval: 5000
    }
  }
})
export default class VehicleVue extends Vue {
  loading?: boolean;
  vehicle?: Vehicle;
  data() {
    return { loading: false, vehicle: undefined };
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
}
</script>

<style></style>
