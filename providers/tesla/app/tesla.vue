<template>
  <div class="provider.name">
    <div v-if="page === 'new' || page === 'auth'">
      <v-card-actions v-if="showAuthButton" class="justify-center">
        <v-btn color="primary" :disabled="loading" :loading="loading" @click="authorize">
          Authorize Access<v-icon right>mdi-chevron-right</v-icon>
        </v-btn>
      </v-card-actions>
      <div v-else>
        <v-card-actions class="justify-center">
          <v-btn text small color="primary" @click="authorize">change Tesla account</v-btn>
        </v-card-actions>
        <div v-if="loading" class="text-center">
          <v-progress-circular indeterminate color="primary" />
        </div>
        <div v-else>
          <div class="justify-center text-center text-subtitle-2 text-uppercase red--text text--darken-4">
            Tesla
            <a :href="teslaVirtualKeyUrl" target="_blank" rel="noopener noreferrer">Virtual Key</a>
            required to control charging.
          </div>
          <div v-if="newVehiclesNotConnected.length > 0">
            <TeslaNewVehicleList :list="newVehiclesNotConnected" @click-select="selectVehicle" />
            <TeslaNewVehicleList v-if="newVehiclesConnected.length > 0" :list="newVehiclesConnected" subheader="Already added" />
          </div>
          <div v-else-if="newVehiclesConnected.length > 0">
            <div class="text-center text-subtitle-2 my-7">
              No new vehicles found, but the following have been re-connected to SmartCharge.
            </div>
            <TeslaNewVehicleList :list="newVehiclesConnected" />
            <v-card-actions class="justify-center">
              <v-btn text small color="primary" @click="$router.push('/')">go back</v-btn>
            </v-card-actions>
          </div>
          <div v-else>
            <div class="text-center text-subtitle-2">No vehicles found</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { strict as assert } from "assert";

import { Component, Vue, Prop } from "vue-property-decorator";
import eventBus, { BusEvent } from "@app/plugins/event-bus.js";
import { hashID } from "@shared/utils.js";
import { TeslaNewListEntry } from "./tesla-helper.js";
import TeslaNewVehicleList from "./components/tesla-new-list.vue";
import { ProviderVuePage } from "@providers/provider-app.js";
import provider, { TeslaProviderQueries, TeslaProviderMutates, TeslaToken } from "../index.js";

const AUTHORIZE_URL = "https://auth.tesla.com/oauth2/v3/authorize";
const CLIENT_ID = "45618b860d7c-4186-89f4-2374bc1b1b83";
const REDIRECT_URL = `${window.location.origin}/provider/tesla/auth`;
const SCOPE = "openid offline_access vehicle_device_data vehicle_charging_cmds";

@Component({
  components: {
    TeslaNewVehicleList,
  },
})
export default class TeslaVue extends Vue {
  @Prop({ default: "view" }) declare readonly page?: ProviderVuePage;

  knownVehicleIDs: { [id: string]: string } = {};

  // REACTIVE PROPERTIES
  loading!: boolean;
  showAuthButton!: boolean;
  allProviderVehicles!: TeslaNewListEntry[];
  get newVehiclesNotConnected() {
    return this.allProviderVehicles.filter((f) => f.vehicle_uuid === undefined);
  }
  get newVehiclesConnected() {
    return this.allProviderVehicles.filter((f) => f.vehicle_uuid !== undefined);
  }
  get teslaVirtualKeyUrl() {
    if (this.$scConfig.TESLA_VIRTUAL_KEY_URL) {
      return this.$scConfig.TESLA_VIRTUAL_KEY_URL;
    } else {
      return `https://tesla.com/_ak/${window.location.hostname}`;
    }
  }

  // HOOKS
  data() {
    // data() hook for undefined values
    return {
      loading: false,
      showAuthButton: false,
      allProviderVehicles: [],
    };
  }

  async mounted() {
    if (this.page === "auth") {
      this.showAuthButton = true;
      this.loading = true;

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      console.debug(`code: ${code}, state: ${state}`);

      if (code === null || state === null || state !== this.authorizeState) {
        console.debug(`Invalid code or state: ${state}`);
        eventBus.$emit(
          BusEvent.AlertWarning,
          "Invalid authorization flow, please try again"
        );
      }

      try {
        const token = await this.$scClient.providerMutate(provider.name, {
          mutation: TeslaProviderMutates.Authorize,
          code,
          callbackURI: REDIRECT_URL,
        });
        // rewrite the URL to remove the code and state and change auth to new
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname.replace("/auth", "/new")
        );
        await this.loadTeslaVehicles(token);
        this.showAuthButton = false;
      } catch (err) {
        console.debug(err);
        eventBus.$emit(
          BusEvent.AlertWarning,
          "Unable to verify Tesla Authorization"
        );
      }
      this.loading = false;
    } else {
      await this.loadTeslaVehicles();
    }
  }

  // ACTIONS
  async loadTeslaVehicles(newProvider?: TeslaToken) {
    this.loading = true;
    this.allProviderVehicles = [];
    // TODO: break this out into a helper function ?
    try {
      for (const v of await this.$scClient.providerQuery(provider.name, {
        query: TeslaProviderQueries.Vehicles,
        token: newProvider,
      })) {
        let entry = this.allProviderVehicles.find((f) => f.vin === v.vin);
        if (!entry) {
          entry = {
            vin: v.vin,
            name: v.display_name || v.vin,
            vehicle_uuid: v.vehicle_uuid,
            service_uuid: v.service_uuid,
          } as TeslaNewListEntry;
          this.allProviderVehicles.push(entry);
        }
      }
    } catch (err) {
      console.debug(err);
      // No need to catch 401 errors here, the server will already handle it
    }

    this.loading = false;
    if (this.allProviderVehicles.length === 0) {
      this.showAuthButton = true;
    }
  }

  async selectVehicle(vehicle: TeslaNewListEntry) {
    this.loading = true;
    await this.$scClient.providerMutate(provider.name, {
      mutation: TeslaProviderMutates.NewVehicle,
      input: vehicle,
    });
    this.loading = false;
    this.$router.push("/");
  }

  get authorizeState() {
    assert(this.$scClient.account, "No user ID found");
    return hashID(this.$scClient.account.id, `teslaAuthState`);
  }
  async authorize() {
    this.loading = true;
    /*
      Parameters
      Name	Required	Example	Description
      response_type	Yes	code	A string, always use the value "code".
      client_id	Yes	abc-123	Partner application client id.
      redirect_uri	Yes	https://example.com/auth/callback	Partner application callback url, spec: rfc6749.
      scope	Yes	openid offline_access user_data vehicle_device_data vehicle_cmds vehicle_charging_cmds	Space delimited list of scopes, include openid and offline_access to obtain a refresh token.
      state	Yes	db4af3f87...	Random value used for validation.
      nonce	No	7baf90cda...	Random value used for replay prevention.
    */
    const authUrl = `${AUTHORIZE_URL}?client_id=${encodeURIComponent(
      CLIENT_ID
    )}&locale=en-US&prompt=login&redirect_uri=${encodeURIComponent(
      REDIRECT_URL
    )}&response_type=code&scope=${encodeURIComponent(
      SCOPE
    )}&state=${encodeURIComponent(
      this.authorizeState
    )}&nonce=${encodeURIComponent(
      hashID(new Date().toISOString(), Math.random().toString())
    )}`;

    window.location.href = authUrl;
  }
}
</script>

<style></style>
