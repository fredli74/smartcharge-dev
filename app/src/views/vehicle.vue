<template>
  <div class="vehicle">
    <div v-if="loading">
      <v-progress-linear indeterminate color="primary"></v-progress-linear>
    </div>
    <v-container v-if="vehicle !== undefined" grid-list-md text-center>
      <v-layout row align-center>
        <v-flex sm6 xs12>
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
          <div v-if="vehicle.pausedUntil">
            Smart charge paused until: {{ vehicle.pausedUntil }}
          </div>
        </v-flex>
        <v-flex sm6 class="hidden-xs-only">
          <v-img max-height="200" :src="vehiclePicture" />
        </v-flex>
        <v-flex sm6 xs12>
          <v-card-actions class="justify-center">
            <v-btn
              v-if="!sleeping"
              depressed
              outlined
              x-small
              fab
              color=""
              :loading="refreshLoading"
              @click="refreshClick()"
              ><v-icon>mdi-refresh</v-icon></v-btn
            >
            <v-btn
              v-if="sleeping"
              depressed
              outlined
              x-small
              fab
              color=""
              :loading="wakeupLoading"
              @click="wakeupClick()"
              ><v-icon>mdi-sleep-off</v-icon></v-btn
            >
            <v-btn
              depressed
              outlined
              x-small
              fab
              color=""
              :loading="hvacLoading"
              @click="hvacClick()"
              ><v-icon
                >mdi-fan{{ vehicle.climateControl ? "-off" : "" }}</v-icon
              ></v-btn
            >
            <v-btn depressed outlined x-small fab color="" @click="tripClick()"
              ><v-icon>mdi-road-variant</v-icon></v-btn
            >
            <v-btn depressed outlined x-small fab color="" @click="pauseClick()"
              ><v-icon>mdi-pause</v-icon></v-btn
            >
            <v-btn
              depressed
              outlined
              x-small
              fab
              color=""
              @click="settingsClick()"
              ><v-icon>mdi-settings</v-icon></v-btn
            >
          </v-card-actions>
        </v-flex>
        <v-flex sm6 xs12>
          <div class="batteryLevel">
            <v-progress-linear
              :style="`width:${vehicle.maximumLevel}%`"
              :value="vehicle.batteryLevel"
              height="25"
              :stream="vehicle.chargingTo"
              :buffer-value="vehicle.chargingTo || vehicle.batteryLevel"
              :color="
                vehicle.batteryLevel > 20
                  ? 'green'
                  : vehicle.batteryLevel > 10
                  ? 'orange'
                  : 'red'
              "
              ><div
                class="batteryText"
                :style="`margin-left:${100 - vehicle.maximumLevel}%`"
              >
                {{ vehicle.batteryLevel }}%
              </div></v-progress-linear
            >
          </div>
          <div v-if="vehicle.chargingTo" class="caption">
            Charging to {{ vehicle.chargingTo }}% (est.
            <RelativeTime
              :time="new Date(Date.now() + vehicle.estimatedTimeLeft)"
            ></RelativeTime
            >)
          </div>
          {{ vehicle.estimatedTimeLeft }}
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
  </div>
</template>

<script lang="ts">
import { strict as assert } from "assert";

import { Component, Vue, Watch } from "vue-property-decorator";
import { Vehicle, Location, Action } from "@shared/gql-types";
import { gql } from "apollo-boost";
import providers from "@providers/provider-apps";
import RelativeTime from "../components/relative-time.vue";
import ChargeChart from "../components/charge-chart.vue";
import { geoDistance, delay } from "@shared/utils";
import apollo from "@app/plugins/apollo";
import { VueApolloComponentOption } from "vue-apollo/types/options";
import { RawLocation } from "vue-router";
import { AgentAction } from "../../../providers/provider-agent";

const vehicleFragment = `id name minimumLevel maximumLevel tripSchedule { level time } pausedUntil geoLocation { latitude longitude } location batteryLevel outsideTemperature insideTemperature climateControl isDriving isConnected chargePlan { chargeStart chargeStop level chargeType comment } chargingTo estimatedTimeLeft status smartStatus updated providerData`;

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
    },
    $subscribe: {
      actions: {
        query: gql`
          subscription ActionSubscription(
            $providerName: String
            $targetID: ID
          ) {
            actionSubscription(
              providerName: $providerName
              targetID: $targetID
            ) {
              actionID
              targetID
              providerName
              action
              data
            }
          }
        `,
        variables() {
          return {
            targetID: this.$route.params.id
          };
        },
        result({ data }: any) {
          const action = data.actionSubscription as Action;
          assert(action.targetID === this.$route.params.id);
          if (action.data.error) {
            throw new Error(action.data.error);
          }
          console.debug(action);
          if (action.action === AgentAction.Update) {
            this.$data.refreshLoading = action.data.result === undefined;
          }
          if (action.action === AgentAction.WakeUp) {
            this.$data.wakeupLoading = action.data.result === undefined;
          }
        }
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
  wakeupLoading!: boolean;
  refreshLoading!: boolean;

  data() {
    return {
      loading: false,
      vehicle: undefined,
      location: undefined,
      locations: undefined,
      prettyStatus: "",
      wakeupLoading: false,
      refreshLoading: false
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

    if (val.isConnected) {
      prefix = "Connected and";
    }

    if (val.location && this.locations) {
      this.location = this.locations.find(f => f.id === val.location);
      assert(this.location !== undefined);

      suffix = `${val.isDriving ? "near" : "@"} ${this.location!.name}`;
    } else {
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

  get sleeping() {
    return (
      this.vehicle &&
      (this.vehicle!.status.toLowerCase() === "offline" ||
        this.vehicle!.status.toLowerCase() === "sleeping")
    );
  }
  get hvacLoading() {
    return false;
  }

  async refreshClick() {
    this.refreshLoading = true;
    apollo.action(
      this.vehicle!.id,
      this.vehicle!.providerData.provider,
      AgentAction.Update
    );
  }
  async wakeupClick() {
    this.wakeupLoading = true;
    try {
      await apollo.action(
        this.vehicle!.id,
        this.vehicle!.providerData.provider,
        AgentAction.WakeUp
      );
      while (this.sleeping) {
        await delay(1000);
      }
      debugger;
      return;
    } finally {
      this.wakeupLoading = false;
    }
  }
  async hvacClick() {
    return true;
  }
  tripClick() {
    return true;
  }
  pauseClick() {
    return true;
  }
  settingsClick() {
    return true;
  }
}
</script>

<style>
.batteryLevel {
  background: #f7f7f7;
  border: 1px solid #9e9e9e;
}
.batteryLevel > div {
  background: #ffffff;
  border-right: 1px solid #dcdcdc;
}
.v-btn--outlined {
  border-color: #909090;
}
</style>
