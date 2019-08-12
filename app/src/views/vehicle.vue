<template>
  <v-flex xs12 class="vehicle">
    <div v-if="loading">
      <v-progress-linear indeterminate color="primary"></v-progress-linear>
    </div>
    <v-container v-if="vehicle !== undefined" grid-list-md text-center>
      <v-layout row align-center>
        <v-flex sm6 xs12>
          <h2>{{ vehicle.name }}</h2>
          <h4>{{ prettyStatus }}</h4>
          <RelativeTime
            :hide-below="15"
            :units="1"
            :time="new Date(vehicle.updated)"
            >Updated
            <template v-slot:suffix>
              ago
            </template>
          </RelativeTime>
          <div v-if="vehicle.pausedUntil">
            Smart charge paused until: {{ vehicle.pausedUntil }}
          </div>
        </v-flex>
        <v-flex sm6 class="hidden-xs-only">
          <v-img max-height="200" :src="vehiclePicture" />
        </v-flex>
        <v-flex v-if="vehicle !== undefined" sm6 xs12 class="mb-5">
          <VehicleActions :vehicle="vehicle"></VehicleActions>
        </v-flex>
        <v-flex sm6 xs12 class="mb-5">
          <div v-if="vehicle.chargingTo" class="mt-n5 caption">
            Charging to {{ vehicle.chargingTo }}%
            <RelativeTime
              until
              :hide-below="120"
              :units="2"
              :time="new Date(Date.now() + vehicle.estimatedTimeLeft * 60e3)"
              >(est.<template v-slot:suffix
                >)
              </template>
            </RelativeTime>
          </div>
          <div class="batteryLevel">
            <v-progress-linear
              :value="vehicle.batteryLevel"
              height="25"
              :stream="vehicle.chargingTo !== null"
              :buffer-value="vehicle.chargingTo || vehicle.batteryLevel"
              :color="
                vehicle.batteryLevel > 20
                  ? 'green'
                  : vehicle.batteryLevel > 10
                  ? 'orange'
                  : 'red'
              "
              ><div class="batteryText">
                {{ vehicle.batteryLevel }}%
              </div></v-progress-linear
            >
            <div class="nochargezone" :style="nochargestyle"></div>
          </div>
        </v-flex>
      </v-layout>
      <v-layout row align-center>
        <v-flex v-if="vehicleConnectedAtUnknownLocation" sm12>
          <p class="mt-5">
            Vehicle is connected at an unknown location and smart charging is
            disabled.
          </p>
          <v-card-actions class="justify-center">
            <router-link :to="addLocationURL">
              <v-btn text small color="primary">add location</v-btn>
            </router-link>
          </v-card-actions>
        </v-flex>
        <template v-else>
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
        </template>
      </v-layout>
    </v-container>
  </v-flex>
</template>

<script lang="ts">
import { strict as assert } from "assert";

import { Component, Vue, Watch } from "vue-property-decorator";
import { Vehicle, Location } from "@shared/gql-types";
import { gql } from "apollo-boost";
import providers from "@providers/provider-apps";
import RelativeTime from "../components/relative-time.vue";
import ChargeChart from "../components/charge-chart.vue";
import VehicleActions from "../components/vehicle-actions.vue";
import { geoDistance } from "@shared/utils";
import apollo from "@app/plugins/apollo";
import { VueApolloComponentOption } from "vue-apollo/types/options";
import { RawLocation } from "vue-router";

const vehicleFragment = `id name minimumLevel maximumLevel tripSchedule { level time } pausedUntil geoLocation { latitude longitude } location batteryLevel outsideTemperature insideTemperature climateControl isDriving isConnected chargePlan { chargeStart chargeStop level chargeType comment } chargingTo estimatedTimeLeft status smartStatus updated providerData`;

@Component({
  components: { VehicleActions, RelativeTime, ChargeChart },
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
        updateQuery: (previousResult: any, { subscriptionData }: any) => {
          return {
            vehicle: {
              ...((previousResult && previousResult.vehicle) || undefined),
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
  loading!: boolean;
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
  get vehiclePicture() {
    if (this.vehicle !== undefined) {
      const provider = providers.find(
        p => p.name === this.vehicle!.providerData.provider
      );
      if (provider && provider.image) {
        return provider.image(this.vehicle);
      }
    }
    return "";
  }
  get vehicleConnectedAtUnknownLocation(): boolean {
    return (
      this.vehicle !== undefined &&
      this.vehicle.isConnected &&
      this.vehicle.location === null
    );
  }
  get addLocationURL(): RawLocation {
    assert(this.vehicle !== undefined);
    return {
      path: "/add/location",
      query: {
        lat: this.vehicle!.geoLocation.latitude.toString(),
        long: this.vehicle!.geoLocation.longitude.toString()
      }
    };
  }

  @Watch("vehicle", { immediate: true, deep: true })
  onVehicleUpdate(val: Vehicle, oldVal: Vehicle) {
    console.debug(`val=${val}, oldVal=${oldVal}`);

    if (!val) return;
    let prefix = "";
    let suffix = "";

    if (val.isConnected && !val.chargingTo) {
      prefix = "Connected and";
    }

    if (val.location && this.locations) {
      this.location = this.locations.find(f => f.id === val.location);
      assert(this.location !== undefined);

      suffix = `${val.isDriving ? "near" : "@"} ${this.location!.name}`;
    } else {
      this.location = undefined;
      // Find closest location
      if (this.locations && this.locations.length > 0) {
        let closest = Number.POSITIVE_INFINITY;
        for (const l of this.locations) {
          const dist =
            geoDistance(
              val.geoLocation.latitude,
              val.geoLocation.longitude,
              l.geoLocation.latitude,
              l.geoLocation.longitude
            ) / 1e3;
          if (dist < closest) {
            if (dist < 1) {
              suffix = "near";
            } else {
              suffix = Number(dist.toFixed(1)).toString() + " km from";
            }
            suffix += " " + l.name;
          }
        }
      }
    }

    this.prettyStatus =
      (prefix ? prefix + " " + val.status.toLowerCase() : val.status) +
      (suffix ? " " + suffix : "");
  }
  get nochargestyle() {
    return `height:25px; width:${100 -
      Math.max(this.vehicle!.batteryLevel, this.vehicle!.maximumLevel)}%`;
  }
}
</script>

<style>
.batteryLevel {
  position: relative;
  background: white;
  border: 1px solid #9e9e9e;
}
.nochargezone {
  position: absolute;
  top: 0;
  right: 0;
  background: #00000008;
  border-left: 1px solid #dcdcdc;
}
.v-btn--outlined {
  border-color: #909090;
}
#vehicle-actions > button {
  margin-left: 12px;
}
</style>
