<template>
  <v-flex xs12 sm11 class="xvga-limit home">
    <v-card xs12 sm10 md8 :loading="$apollo.loading">
      <v-card-title><span class="headline">Settings</span></v-card-title>
      <v-spacer />
      <v-card-subtitle class="subtitle-1">Vehicles</v-card-subtitle>
      <v-card-text class="pb-0">
        <div v-if="$apollo.queries.vehicles.loading">
          <v-progress-linear indeterminate color="primary" />
        </div>
        <v-expansion-panels
          v-else
          :value="vehicles && vehicles.length > 1 ? undefined : 0"
        >
          <v-expansion-panel v-for="vehicle in vehicles" :key="vehicle.id">
            <v-expansion-panel-header>
              {{
                vehicle.name
              }}
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <div
                class="
                  font-light
                  overline
                  caption
                  mr-4
                  mt-n5
                  secondary--text
                  text--lighten-2
                "
              >
                ({{ vehicle.id }})
              </div>
              <EditVehicle
                :vehicle="vehicle"
                :locations="locations"
                @refresh="$apollo.queries.vehicles.refetch()"
              />
            </v-expansion-panel-content>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
      <v-card-actions>
        <v-btn class="ma-2" outlined color="primary" to="/add/vehicle">
          <v-icon left>mdi-plus</v-icon>add vehicle
        </v-btn>
      </v-card-actions>
      <v-spacer />
      <v-card-subtitle class="subtitle-1">Locations</v-card-subtitle>
      <v-card-text class="pb-0">
        <div v-if="$apollo.queries.locations.loading">
          <v-progress-linear indeterminate color="primary" />
        </div>
        <v-expansion-panels
          v-else
          :value="locations && locations.length > 1 ? undefined : 0"
        >
          <v-expansion-panel v-for="location in locations" :key="location.id">
            <v-expansion-panel-header>
              {{
                location.name
              }}
            </v-expansion-panel-header>
            <v-expansion-panel-content>
              <div
                class="
                  font-light
                  overline
                  caption
                  mr-4
                  mt-n5
                  secondary--text
                  text--lighten-2
                "
              >
                ({{ location.id }})
              </div>
              <EditLocation
                :location="location"
                @refresh="$apollo.queries.locations.refetch()"
              />
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
      <v-spacer />
    </v-card>
  </v-flex>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";
import gql from "graphql-tag";
import EditVehicle from "@app/components/edit-vehicle.vue";
import EditLocation from "@app/components/edit-location.vue";
import { GQLVehicle, GQLLocation } from "@shared/sc-schema.js";

@Component({
  components: { EditVehicle, EditLocation },
  apollo: {
    locations: {
      query: gql`
        query GetLocations {
          locations {
            id
            ownerID
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
      `,
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
              locationID
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
      pollInterval: 5000,
    },
  },
})
export default class Home extends Vue {
  loading?: boolean;
  vehicles?: GQLVehicle[];
  locations?: GQLLocation[];

  data() {
    return { loading: false, vehicles: undefined, locations: undefined };
  }
}
</script>
