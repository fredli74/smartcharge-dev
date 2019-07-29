<template>
  <div class="tesla">
    <div v-if="page === 'new'">
      <TeslaTokenVue v-if="showTokenForm" @token="newProvider" />
      <div v-else>
        <v-btn text small flat color="primary" @click="showTokenForm = true"
          >change Tesla account</v-btn
        >
        <div v-if="loading">
          <v-progress-circular
            indeterminate
            color="primary"
          ></v-progress-circular>
        </div>
        <TeslaNewVehicleList
          v-if="newVehiclesNotConnected.length > 0"
          :list="newVehiclesNotConnected"
          v-on:click-select="selectVehicle"
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
import { ProviderVuePage } from "@providers/provider-apps";
import apollo from "@app/plugins/apollo";
import { IRestToken } from "@shared/restclient";
import { Provider } from "@shared/gql-types";
import { refreshToken, TeslaNewListEntry } from "./tesla-helper";
import config from "../tesla-config";
import TeslaTokenVue from "./components/tesla-token.vue";
import TeslaNewVehicleList from "./components/tesla-new-list.vue";

@Component({
  components: {
    TeslaTokenVue,
    TeslaNewVehicleList
  }
})
export default class TeslaVue extends Vue {
  @Prop({ default: "view" })
  page?: ProviderVuePage;

  providers: Provider[] = [];
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
    this.loading = true;
    this.providers = await apollo.getProviders(["tesla"]);
    for (const v of await apollo.getVehicles()) {
      if (
        v.providerData &&
        v.providerData.sid &&
        v.providerData.provider === "tesla"
      ) {
        this.knownVehicleIDs[v.providerData.sid] = v.id;
      }
    }
    this.showTokenForm = this.providers.length === 0;
    if (!this.showTokenForm) {
      this.loadList();
    }
  }

  // ACTIONS
  async newProvider(token: IRestToken) {
    const provider = await apollo.newProvider("tesla", { token });
    this.providers!.push(provider);
    this.showTokenForm = false;
    this.loadList();
  }

  async loadList() {
    this.loading = true;
    this.allProviderVehicles = [];
    for (const provider of this.providers!) {
      provider.data.token = await refreshToken(provider.data.token);
      const list = await apollo.providerQuery("tesla", {
        query: "vehicles",
        token: provider.data.token
      });
      for (const v of list) {
        if (this.allProviderVehicles.findIndex(f => f.id === v.id_s) < 0) {
          this.allProviderVehicles.push({
            provider_uuid: provider.id,
            name: v.display_name,
            vin: v.vin,
            id: v.id_s,
            controlled: this.knownVehicleIDs[v.id_s] !== undefined
          });
        }
      }
    }
    this.loading = false;
  }

  async selectVehicle(vehicle: TeslaNewListEntry) {
    this.loading = true;
    await apollo.newVehicle({
      name: vehicle.name,
      minimumLevel: config.DEFAULT_MINIMUM_LEVEL,
      maximumLevel: config.DEFAULT_MAXIMUM_LEVEL,
      providerID: vehicle.provider_uuid,
      providerData: { provider: "tesla", sid: vehicle.id }
    });
    this.loading = false;
    this.$router.push("/");
  }
}
</script>

<style></style>
