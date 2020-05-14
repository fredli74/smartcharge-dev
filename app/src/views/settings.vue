<template>
  <v-flex xs12 sm11 class="xvga-limit home">
    <v-card xs12 sm10 md8 :loading="$apollo.loading">
      <v-card-title><span class="headline">Settings</span></v-card-title>
      <v-spacer></v-spacer>
      <v-card-subtitle class="subtitle-1">Locations</v-card-subtitle>
      <v-card-text class="pb-0">
        <div v-if="false">
          <v-progress-linear indeterminate color="primary"></v-progress-linear>
        </div>
        <v-expansion-panels>
          <v-expansion-panel v-for="location in locations" :key="location.id">
            <v-expansion-panel-header>{{
              location.name
            }}</v-expansion-panel-header>
            <v-expansion-panel-content>
              <div
                class="font-light overline caption mr-4 mt-n5 secondary--text text--lighten-2"
              >
                ({{ location.id }})
              </div>
              <EditLocation :location="location"></EditLocation>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="false"
          class="ma-2"
          outlined
          color="primary"
          to="/add/location"
        >
          <v-icon left>mdi-plus</v-icon>add location
        </v-btn>
      </v-card-actions>
      <v-spacer></v-spacer>
      <v-card-subtitle class="subtitle-1">Vehicles</v-card-subtitle>
      <v-card-text class="pb-0">
        <div v-if="$apollo.queries.vehicles.loading">
          <v-progress-linear indeterminate color="primary"></v-progress-linear>
        </div>
        <v-expansion-panels>
          <v-expansion-panel v-for="vehicle in vehicles" :key="vehicle.id">
            <v-expansion-panel-header>{{
              vehicle.name
            }}</v-expansion-panel-header>
            <v-expansion-panel-content>
              <div
                class="font-light overline caption mr-4 mt-n5 secondary--text text--lighten-2"
              >
                ({{ vehicle.id }})
              </div>
              <EditVehicle
                :vehicle="vehicle"
                :locations="locations"
              ></EditVehicle>
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
      <v-card-actions>
        <v-btn class="ma-2" outlined color="primary" to="/add/vehicle">
          <v-icon left>mdi-plus</v-icon>add vehicle
        </v-btn>
      </v-card-actions>
      <v-spacer></v-spacer>
    </v-card>
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import { gql } from "apollo-boost";
import providers from "@providers/provider-apps";
import EditVehicle from "@app/components/edit-vehicle.vue";
import EditLocation from "@app/components/edit-location.vue";
import { GQLVehicle, GQLLocation } from "@shared/sc-schema";

@Component({
  components: { EditVehicle, EditLocation },
  apollo: {
    locations: {
      query: gql`
        query GetLocations {
          locations {
            id
            name
            geoLocation {
              latitude
              longitude
            }
            geoFenceRadius
            providerData
            priceList {
              id
              name
            }
          }
        }
      `
    },
    vehicles: {
      query: gql`
        query GetVehicles {
          vehicles {
            id
            ownerID
            name
            maximumLevel
            locationSettings {
              location
              directLevel
              goal
            }
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
  vehicles?: GQLVehicle[];
  locations?: GQLLocation[];

  data() {
    return { loading: false, vehicles: undefined, locations: undefined };
  }
  async created() {
    // this.locations = await apollo.getLocations();
  }
  async mounted() {
    // this.loading = true;
    // this.vehicles = await apollo.getVehicles();
    // this.loading = false;
  }

  vehicleDisabled(vehicle: GQLVehicle): string | undefined {
    if (vehicle.providerData.invalid_token) {
      return "invalid provider token, please add again";
    }
    if (vehicle.odometer === 0 || vehicle.status === "") {
      return "not polled yet, make sure it is online";
    }
    return undefined;
  }

  vehiclePicture(vehicle: GQLVehicle) {
    if (vehicle.providerData && vehicle.providerData.unknown_image) {
      return require("../assets/unknown_vehicle.png");
    } else {
      const provider = providers.find(
        p => p.name === vehicle.providerData.provider
      );
      if (provider && provider.image) {
        return provider.image(vehicle, true);
      } else {
        return "";
      }
    }
  }
  selectVehicle(vehicle: GQLVehicle) {
    this.$router.push(`/vehicle/${vehicle.id}`);
  }
}
</script>
