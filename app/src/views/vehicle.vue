<template>
  <div class="vehicle">
    <div v-if="loading">
      <v-progress-linear indeterminate color="primary"></v-progress-linear>
    </div>
    <v-container v-if="vehicle !== undefined" grid-list-md text-center>
      <v-layout wrap>
        <v-flex sm6>
          <h2>{{ vehicle.name }}</h2>
          <h3>
            {{ prettyStatus }}
            <div class="caption">
              ({{ vehicle.status }}
              <span
                >@ {{ (location && location.name) || "unknown location" }}</span
              >)
            </div>
          </h3>
          <div>
            Updated
            <RelativeTime :time="new Date(vehicle.updated)"></RelativeTime>
          </div>
        </v-flex>
        <v-flex sm6>
          <v-img contain :src="vehiclePicture(vehicle)" />
          <v-progress-linear
            class="batteryLevel"
            :value="vehicle.batteryLevel"
            height="33"
            :buffer-value="vehicle.maximumLevel"
            :color="
              vehicle.batteryLevel > 20
                ? 'green'
                : vehicle.batteryLevel > 10
                ? 'orange'
                : 'red'
            "
            >{{ vehicle.batteryLevel }}%</v-progress-linear
          ><v-progress-linear
            :value="vehicle.batteryLevel"
            height="3"
            color="cyan"
            :buffer-value="vehicle.maximumLevel"
          ></v-progress-linear>
        </v-flex>
        <v-flex sm12 class="caption">
          {{ vehicle.smartStatus }}
        </v-flex>
        <v-flex sm12>
          <chargeChart
            v-if="vehicle && location"
            :vehicle="vehicle.id"
            :location="location.id"
          ></chargeChart>
        </v-flex>
      </v-layout>
    </v-container>
  </div>
</template>

<script lang="ts">
import { strict as assert } from "assert";

import { Component, Vue, Watch } from "vue-property-decorator";
import { Vehicle, Location } from "@shared/gql-types";
import { gql } from "apollo-boost";
import providers from "@providers/provider-apps";
import RelativeTime from "../components/relative-time.vue";
import ChargeChart from "../components/charge-chart.vue";
import { geoDistance } from "../../../shared/utils";
import apollo from "@app/plugins/apollo";
import { VueApolloComponentOption } from "vue-apollo/types/options";

const vehicleFragment = `id name minimumLevel maximumLevel tripSchedule { level time } pausedUntil geoLocation { latitude longitude } location batteryLevel outsideTemperature insideTemperature climateControl isDriving isConnected chargePlan { chargeStart chargeStop level chargeType comment } chargingTo estimatedTimeLeft status smartStatus updated providerData`;
//const locationFragment = `id name geoLocation { latitude longitude } geoFenceRadius`;

@Component({
  components: { RelativeTime, ChargeChart },
  apollo: {
    vehicle: {
      query: gql`
        query GetVehicle($id: String!) {
          vehicle(id: $id) { ${vehicleFragment} }
        }
      `,
      variables() {
        return {
          id: this.$route.params.id
        };
      },
      fetchPolicy: "cache-and-network",
      pollInterval: 5 * 60e3, // poll at least every 5 minutes
      subscribeToMore: {
        document: gql`subscription VehicleSubscription($id:String!) { vehicleSubscription(id: $id) { ${vehicleFragment} } }`,
        variables() {
          return {
            id: this.$route.params.id
          };
        },
        fetchPolicy: "cache-and-network",
        // Mutate the previous result
        updateQuery: (previousResult, { subscriptionData }) => {
          return {
            vehicle: {
              ...previousResult.vehicle,
              ...subscriptionData.data.vehicleSubscription
            }
          };
        },
        skip() {
          return this.locations === undefined;
        }
      },

      //update: data => data.vehicles,
      watchLoading(isLoading, _countModifier) {
        this.loading = isLoading;
      },
      skip() {
        return this.locations === undefined;
      }
    }
  } as VueApolloComponentOption<VehicleVue> // needed because skip is not declared on subscribeToMore, but I am pretty sure I had to have it in my tests when the query had toggled skip()
})
export default class VehicleVue extends Vue {
  loading?: boolean;
  vehicle?: Vehicle;
  location?: Location;
  locations!: Location[];
  prettyStatus!: string;

  data() {
    return {
      loading: false,
      vehicle: undefined,
      location: undefined,
      locations: undefined,
      prettyStatus: ""
    };
  }
  async created() {
    this.locations = await apollo.getLocations();
    this.$apollo.queries.vehicle.skip = false;
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

  @Watch("vehicle", { immediate: true, deep: true })
  onVehicleUpdate(val: Vehicle, oldVal: Vehicle) {
    console.debug(`val=${val}, oldVal=${oldVal}`);

    if (val && val.location && this.locations) {
      this.location = this.locations.find(f => f.id === val.location);
      assert(location !== undefined);

      if (val.isDriving) {
        this.prettyStatus = `${val.status} near ${this.location!.name}`;
      } else {
        if (val.isConnected) {
          this.prettyStatus = `Connected and ${val.status}`;
        } else this.prettyStatus = val.status;
      }
      this.prettyStatus += ` @ ${this.location!.name}`;
    } else {
      if (!val) {
        return;
      }

      // Find closest location
      if (!this.locations || this.locations.length <= 0) {
        this.prettyStatus = val.status;
      } else {
        let closest = Number.POSITIVE_INFINITY;
        for (const l of this.locations) {
          const dist = geoDistance(
            val.geoLocation.latitude,
            val.geoLocation.longitude,
            l.geoLocation.latitude,
            l.geoLocation.longitude
          );
          if (dist < closest) {
            this.prettyStatus = `${val.status} ${Number(
              (dist / 1e3).toFixed(1)
            )} km from ${l.name}`;
          }
          console.debug(dist);
        }
        //
      }
    }
  }
}
</script>

<style>
.batteryLevel {
  font-weight: bold;
  color: #000;
  border: 1px solid #424242;
  /* text-shadow: 0 0 2px #ffffff;*/
}
</style>
