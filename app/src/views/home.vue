<template>
  <v-flex xs12 sm11 class="xvga-limit home">
    <div v-if="loading">
      <v-progress-linear indeterminate color="primary" />
    </div>
    <v-card xs12 sm10 md8>
      <v-list-item
        v-for="vehicle in vehicles"
        :key="vehicle.id"
        :disabled="vehicleDisabled(vehicle) !== undefined"
        two-line
        @click="selectVehicle(vehicle)"
      >
        <v-container fluid grid-list-md>
          <v-layout align-center justify-space-around>
            <v-flex xs4 sm5>
              <v-img
                max-height="100"
                min-height="100"
                contain
                :src="vehiclePicture(vehicle)"
              />
            </v-flex>
            <v-flex xs7 sm6>
              <v-list-item-content>
                <v-list-item-title class="pb-1">
                  {{
                    vehicle.name
                  }}
                </v-list-item-title>
                <v-list-item-subtitle class="text-lowercase">
                  {{ vehicle.status }}
                </v-list-item-subtitle>
                <v-list-item-subtitle
                  v-if="vehicleDisabled(vehicle) !== undefined"
                  class="text-lowercase caption"
                >
                  {{ vehicleDisabled(vehicle) }}
                </v-list-item-subtitle>
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
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import providers from "@providers/provider-apps.js";
import { GQLVehicle } from "@shared/sc-schema.js";
import gql from "graphql-tag";

@Component({
  components: {},
  apollo: {
    vehicles: {
      query: gql`
        query GetVehicles {
          vehicles {
            id
            name
            odometer
            batteryLevel
            status
            serviceID
            providerData
          }
        }
      `,
      //update: data => data.vehicles,
      watchLoading(isLoading, _countModifier) {
        this.loading = isLoading;
      },
      pollInterval: 5000,
    },
  },
})
export default class Home extends Vue {
  loading?: boolean;
  vehicles?: GQLVehicle[];

  data() {
    return { loading: false, vehicles: undefined };
  }
  async mounted() {
    // this.loading = true;
    // this.vehicles = await apollo.getVehicles();
    // this.loading = false;
  }

  vehicleDisabled(vehicle: GQLVehicle): string | undefined {
    if (vehicle.providerData.error) {
      return "disabled due to error (re-enable in settings)";
    }
    if (vehicle.providerData.invalid_token || !vehicle.serviceID) {
      return "invalid provider token, please add again";
    }
    if (vehicle.providerData.disabled) {
      return "disabled by user";
    }
    if (vehicle.odometer === 0 || vehicle.status === "") {
      return "not polled yet, this can take a few minutes";
    }
    return undefined;
  }

  vehiclePicture(vehicle: GQLVehicle) {
    const provider = providers.find(
      (p) => p.name === vehicle.providerData.provider
    );
    if (provider && provider.image) {
      return provider.image(vehicle, false);
    } else {
      return "";
    }
  }
  selectVehicle(vehicle: GQLVehicle) {
    this.$router.push(`/vehicle/${vehicle.id}`);
  }
}
</script>
