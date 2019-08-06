<template>
  <div class="provider.name">
    <div v-if="page === 'new'">
      <TeslaTokenVue v-if="showTokenForm" @token="newProvider" />
      <div v-else>
        <v-card-actions class="justify-center">
          <v-btn text small color="primary" @click="showTokenForm = true"
            >change Tesla account</v-btn
          >
        </v-card-actions>
        <div v-if="loading" class="text-center">
          <v-progress-circular
            indeterminate
            color="primary"
          ></v-progress-circular>
        </div>
        <TeslaNewVehicleList
          v-if="newVehiclesNotConnected.length > 0"
          :list="newVehiclesNotConnected"
          @click-select="selectVehicle"
        />
        <TeslaNewVehicleList
          v-if="newVehiclesConnected.length > 0"
          :list="newVehiclesConnected"
          subheader="Already added"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";
import { IRestToken } from "@shared/restclient";
import { TeslaNewListEntry, TeslaProviderData } from "./tesla-helper";
import config from "../tesla-config";
import TeslaTokenVue from "./components/tesla-token.vue";
import TeslaNewVehicleList from "./components/tesla-new-list.vue";
import { LogLevel, log } from "@shared/utils";
import { ProviderVuePage } from "@providers/provider-app";
import provider from "..";

@Component({
  components: {
    TeslaTokenVue,
    TeslaNewVehicleList
  }
})
export default class TeslaVue extends Vue {
  @Prop({ default: "view" })
  page?: ProviderVuePage;

  knownVehicleIDs: { [id: string]: string } = {};

  // REACTIVE PROPERTIES
  loading!: boolean;
  showTokenForm!: boolean;
  allProviderVehicles!: TeslaNewListEntry[];
  get newVehiclesNotConnected() {
    return this.allProviderVehicles.filter(f => !f.controlled);
  }
  get newVehiclesConnected() {
    return this.allProviderVehicles.filter(f => f.controlled);
  }

  // HOOKS
  data() {
    // data() hook for undefined values
    return {
      loading: false,
      showTokenForm: false,
      allProviderVehicles: []
    };
  }

  async mounted() {
    await this.loadTeslaVehicles();
  }

  // ACTIONS
  async loadTeslaVehicles(newProvider?: IRestToken) {
    this.loading = true;

    const vehicles = (await apollo.getVehicles()).filter(
      f => f.providerData && f.providerData.provider === provider.name
    );
    const providers: { [token: string]: IRestToken } = newProvider
      ? {
          [newProvider.access_token]: newProvider
        }
      : {};

    // Pickup provider list from all connected vehicles
    for (const v of vehicles) {
      if (!v.providerData.invalidToken && v.providerData.token) {
        providers[v.providerData.token.access_token] = v.providerData.token;
      }
    }

    this.allProviderVehicles = [];
    for (const token of Object.values(providers)) {
      // TODO: break this out into a helper function ?
      try {
        for (const v of await apollo.providerQuery(provider.name, {
          query: "vehicles",
          token
        })) {
          let entry = this.allProviderVehicles.find(f => f.id === v.id_s);
          if (!entry) {
            entry = {
              id: v.id_s,
              vin: v.vin,
              name: v.display_name,
              tesla_token: token,
              controlled: false
            };
            this.allProviderVehicles.push(entry);
          }
          for (const f of vehicles) {
            if (f.providerData.sid === v.id_s) {
              entry.controlled = true;
              if (
                !f.providerData.token ||
                f.providerData.invalidToken ||
                f.providerData.token.access_token !== token.access_token
              ) {
                log(
                  LogLevel.Info,
                  `Vehicle ${
                    f.id
                  } did not have the correct token defined in providerData`
                );
                await apollo.updateVehicle({
                  id: f.id,
                  providerData: {
                    provider: provider.name,
                    token,
                    invalidToken: null
                  }
                });
              }
            }
          }
        }
      } catch (err) {
        console.debug(err);
        // No need to catch 401 errors here, the server will already handle it
      }
    }
    this.loading = false;
    if (this.allProviderVehicles.length === 0) {
      this.showTokenForm = true;
    }
  }

  async newProvider(token: IRestToken) {
    this.showTokenForm = false;
    this.loadTeslaVehicles(token);
  }

  async selectVehicle(vehicle: TeslaNewListEntry) {
    this.loading = true;
    await apollo.newVehicle({
      name: vehicle.name,
      minimumLevel: config.DEFAULT_MINIMUM_LEVEL,
      maximumLevel: config.DEFAULT_MAXIMUM_LEVEL,
      providerData: {
        provider: provider.name,
        sid: vehicle.id,
        token: vehicle.tesla_token
      } as TeslaProviderData
    });
    this.loading = false;
    this.$router.push("/");
  }
}
</script>

<style></style>
