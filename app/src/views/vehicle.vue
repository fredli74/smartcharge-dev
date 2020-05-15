<template>
  <v-flex xs12 class="vehicle autosize">
    <div v-if="loading">
      <v-progress-linear indeterminate color="primary"></v-progress-linear>
    </div>
    <v-container v-if="vehicle !== undefined" grid-list-md text-center fluid>
      <v-layout row align-center>
        <v-flex sm6 xs12>
          <h2>{{ vehicle.name }}</h2>
          <h6>{{ prettyStatus }}</h6>
          <RelativeTime
            style="font-size:0.7em; font-weight:light"
            :hide-below="15"
            :units="1"
            :time="new Date(vehicle.updated)"
            >Updated
            <template v-slot:suffix>
              ago
            </template>
          </RelativeTime>
          <div
            v-if="Boolean(vehicle.pausedUntil)"
            class="pt-4"
            style="font-size:0.9em"
          >
            Smart charge paused until
            <div class="text-no-wrap">{{ pauseText }}</div>
          </div>
        </v-flex>
        <v-flex sm6 grow class="">
          <v-layout row align-center>
            <v-flex sm12 grow class="d-none d-sm-flex">
              <v-img id="vehicle-picture" :src="vehiclePicture" />
              <v-tooltip v-if="vehiclePictureUnknown" left>
                <template v-slot:activator="{ on }">
                  <v-btn
                    class="mx-2"
                    absolute
                    right
                    fab
                    dark
                    small
                    color="warning"
                    :href="vehiclePictureReportURL"
                    target="_blank"
                    v-on="on"
                    ><v-icon dark>mdi-bug</v-icon></v-btn
                  >
                </template>
                <span>Report incorrect image</span>
              </v-tooltip>
            </v-flex>
            <v-flex sm12 grow class="">
              <div v-if="freshInfo" id="temperatures" style="margin:0 auto">
                <div>
                  <v-icon>mdi-weather-partly-cloudy</v-icon
                  >{{ Number(vehicle.outsideTemperature).toFixed(1) }}&#176;
                </div>
                <div>
                  <v-icon style="top:1px;">mdi-car</v-icon
                  >{{ Number(vehicle.insideTemperature).toFixed(1) }}&#176;
                </div>
              </div>
            </v-flex>
          </v-layout>
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
              >(est.<template v-slot:suffix>) </template>
            </RelativeTime>
          </div>
          <div class="batteryLevel">
            <div
              v-if="vehicle.chargingTo"
              class="chargezone"
              :style="`border-color:${batteryColor}`"
            ></div>
            <div class="nochargezone" :style="nochargestyle"></div>
            <v-progress-linear
              :value="vehicle.batteryLevel"
              height="1.5em"
              :buffer-value="vehicle.chargingTo || vehicle.batteryLevel"
              :color="batteryColor"
              ><div class="batteryText">
                {{ vehicle.batteryLevel }}%
              </div></v-progress-linear
            >
          </div>
        </v-flex>
      </v-layout>
      <v-layout row align-center>
        <v-flex v-if="vehicleConnectedAtUnknownLocation" sm12>
          <p class="mt-5">
            Vehicle connected at location whithout smart charging.
          </p>
          <v-card-actions class="justify-center">
            <router-link :to="addLocationURL">
              <v-btn text small color="primary">add location</v-btn>
            </router-link>
          </v-card-actions>
        </v-flex>
        <template v-else>
          <v-flex sm12 class="body-2">
            {{ replaceISOtime(vehicle.smartStatus) }}
          </v-flex>
          <v-flex sm12>
            <chargeChart
              v-if="vehicle && location"
              :vehicle="vehicle"
              :location="location"
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
import { gql } from "apollo-boost";
import providers from "@providers/provider-apps";
import RelativeTime from "@app/components/relative-time.vue";
import ChargeChart from "@app/components/charge-chart.vue";
import VehicleActions from "@app/components/vehicle-actions.vue";
import { geoDistance } from "@shared/utils";
import apollo from "@app/plugins/apollo";
import { VueApolloComponentOptions } from "vue-apollo/types/options";
import { RawLocation } from "vue-router";
import moment from "moment";
import config from "@shared/smartcharge-config";
import { makePublicID } from "@shared/utils";
import { GQLVehicle, GQLLocation } from "@shared/sc-schema";

const vehicleFragment = `id ownerID name maximumLevel tripSchedule { level time } pausedUntil geoLocation { latitude longitude } location locationSettings { location directLevel goal } batteryLevel outsideTemperature insideTemperature climateControl isDriving isConnected chargePlan { chargeStart chargeStop level chargeType comment } chargingTo estimatedTimeLeft status smartStatus updated serviceID providerData`;

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

      update(data) {
        if (data.vehicle && data.vehicle.pausedUntil) {
          const when = new Date(data.vehicle.pausedUntil).getTime();
          const now = Date.now();
          if (when <= now) {
            data.vehicle.pausedUntil = null;
          }
        }
        if (data.vehicle && data.vehicle.tripSchedule) {
          const when = new Date(data.vehicle.tripSchedule.time).getTime();
          const now = Date.now();
          if (when + 3600e3 <= now) {
            data.vehicle.tripSchedule = null;
          }
        }
        this.updateFreshness(data.vehicle);
        return data.vehicle;
      },
      watchLoading(isLoading, _countModifier) {
        this.loading = isLoading;
      },
      skip() {
        return this.locations === undefined;
      }
    }
  } as VueApolloComponentOptions<VehicleVue> // needed because skip is not declared on subscribeToMore, but I am pretty sure I had to have it in my tests when the query had toggled skip()
})
export default class VehicleVue extends Vue {
  loading!: boolean;
  vehicle?: GQLVehicle;
  location?: GQLLocation;
  locations!: GQLLocation[];
  prettyStatus!: string;
  freshInfo!: boolean;

  data() {
    return {
      loading: false,
      vehicle: undefined,
      location: undefined,
      locations: undefined,
      prettyStatus: "",
      freshInfo: false
    };
  }

  updateFreshness(vehicle: GQLVehicle | undefined) {
    this.freshInfo = Boolean(
      vehicle && Date.now() - new Date(vehicle.updated).getTime() < 300e3
    ); // five minutes
  }

  timer?: any;
  async created() {
    this.locations = await apollo.getLocations();
    this.$apollo.queries.vehicle.skip = false;

    this.timer = setInterval(() => {
      if (this.vehicle && this.vehicle.pausedUntil) {
        const when = new Date(this.vehicle.pausedUntil).getTime();
        const now = Date.now();
        if (when <= now) {
          this.vehicle.pausedUntil = undefined;
        }
      }
      if (this.vehicle && this.vehicle.tripSchedule) {
        const when = new Date(this.vehicle.tripSchedule.time).getTime();
        const now = Date.now();
        if (when + 3600e3 <= now) {
          this.vehicle.tripSchedule = undefined;
        }
      }
      this.updateFreshness(this.vehicle);
    }, 30e3);
  }
  beforeDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  get vehiclePictureUnknown() {
    return (
      config.SINGLE_USER === "false" &&
      this.vehicle &&
      this.vehicle.providerData &&
      this.vehicle.providerData.unknown_image
    );
  }

  get vehiclePictureReportURL() {
    if (this.vehicle !== undefined) {
      const publicID = makePublicID(this.vehicle.id);
      return `https://github.com/fredli74/smartcharge-dev/issues/new?assignees=&labels=enhancement&template=incorrect-image.md&title=Wrong+vehicle+image+for+${publicID}`;
    }
    return "";
  }

  get vehiclePicture() {
    if (this.vehicle !== undefined) {
      if (this.vehiclePictureUnknown) {
        return require("../assets/unknown_vehicle.png");
      } else {
        const provider = providers.find(
          p => p.name === this.vehicle!.providerData.provider
        );
        if (provider && provider.image) {
          return provider.image(this.vehicle);
        }
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
  onVehicleUpdate(val: GQLVehicle, _oldVal: GQLVehicle) {
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
            closest = dist;
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
  get batteryColor() {
    return this.vehicle!.batteryLevel > this.vehicle!.maximumLevel
      ? "#9cef19"
      : this.vehicle!.batteryLevel > 75 /* TODO  MINIMUM LEVEL */
      ? "#4cd853"
      : this.vehicle!.batteryLevel > 10
      ? "orange"
      : "red";
  }
  get nochargestyle() {
    const width =
      100 - Math.max(this.vehicle!.chargingTo || 0, this.vehicle!.maximumLevel);
    if (width > 0) {
      return `width:${width}%`;
    } else {
      return `display:none`;
    }
  }

  get pauseText() {
    return (
      this.vehicle &&
      this.vehicle.pausedUntil &&
      moment(this.vehicle.pausedUntil).format("YYYY-MM-DD HH:mm")
    );
  }

  replaceISOtime(s: string): string {
    return s.replace(
      /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/g,
      f => moment(f).format("YYYY-MM-DD HH:mm")
    );
  }
}
</script>

<style>
.batteryLevel {
  position: relative;
  background: white;
  border: 1px solid #9e9e9e;
  overflow: hidden;
}
.batteryText {
  font-weight: bold;
}
.chargezone {
  animation: stream 0.25s infinite linear;
  border-top: 4px dotted;
  bottom: 0;
  opacity: 0.5;
  pointer-events: none;
  position: absolute;
  right: -8px;
  top: calc(50% - 2px);
  transition: inherit;
  width: 100%;
}
.nochargezone {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  border-left: 1px solid #dcdcdc;
  background-color: #fdfdfd;
  background-image: linear-gradient(
    135deg,
    rgba(0, 0, 0, 0.05) 25%,
    transparent 0,
    transparent 50%,
    rgba(0, 0, 0, 0.05) 0,
    rgba(0, 0, 0, 0.05) 75%,
    transparent 0,
    transparent
  );
  background-size: 20px 20px;
  background-repeat: repeat;
}
.v-btn--outlined {
  border-color: #909090;
}
#vehicle-actions > button {
  margin-left: 14px;
}
#vehicle-picture {
  pointer-events: none;
  margin: -10% 0;
}

#temperatures {
  font-size: 0.8em;
  color: #666666;
}
#temperatures > div {
  display: inline-block;
}
#temperatures > div + div {
  margin-left: 1em;
}
#temperatures .v-icon {
  font-size: 90%;
  margin-right: 0.2em;
  vertical-align: baseline;
  position: relative;
}
</style>
