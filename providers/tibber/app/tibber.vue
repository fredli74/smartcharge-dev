<template>
  <div class="provider.name">
    <div v-if="page === 'new'">
      <TibberTokenVue v-if="showTokenForm" @token="newProvider" />
      <div v-else>
        <v-card-actions class="justify-center">
          <v-btn text small color="primary" @click="showTokenForm = true"
            >change Tibber account</v-btn
          >
        </v-card-actions>
        <div v-if="loading" class="text-center">
          <v-progress-circular
            indeterminate
            color="primary"
          ></v-progress-circular>
        </div>
        <TibberNewHomeList
          v-if="newHomesNotConnected.length > 0"
          :list="newHomesNotConnected"
          @click-select="selectHome"
        />
        <TibberNewHomeList
          v-if="newHomesConnected.length > 0"
          :list="newHomesConnected"
          subheader="Already added"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";
import TibberTokenVue from "./components/tibber-token.vue";
import TibberNewHomeList from "./components/tibber-new-list.vue";
import { LogLevel, log } from "@shared/utils";
import { ProviderVuePage } from "@providers/provider-app";
import provider, { TibberProviderData } from "..";
import { getHomes } from "./tibber-helper";

// List entry when adding a new Tibber home
export interface TibberNewListEntry {
  name: string; // name of home
  id: string; // tibber id to control home
  nickname: string;
  tibber_token: string; // token to access tibberAPI
  controlled: boolean; // Already controlled by smartcharge
}

@Component({
  components: {
    TibberTokenVue,
    TibberNewHomeList
  }
})
export default class TibberVue extends Vue {
  @Prop({ default: "view" })
  page?: ProviderVuePage;

  knownHomeIDs: { [id: string]: string } = {};

  // REACTIVE PROPERTIES
  loading!: boolean;
  showTokenForm!: boolean;
  allProviderHomes!: TibberNewListEntry[];
  get newHomesNotConnected() {
    return this.allProviderHomes.filter(f => !f.controlled);
  }
  get newHomesConnected() {
    return this.allProviderHomes.filter(f => f.controlled);
  }

  // HOOKS
  data() {
    // data() hook for undefined values
    return {
      loading: false,
      showTokenForm: false,
      allProviderHomes: []
    };
  }

  async mounted() {
    await this.loadTibberHomes();
  }

  // ACTIONS
  async loadTibberHomes(newProvider?: string) {
    this.loading = true;

    const homes = (await apollo.getLocations()).filter(
      f => f.providerData && f.providerData.provider === provider.name
    );
    const providers: { [token: string]: string } = newProvider
      ? {
          [newProvider]: newProvider
        }
      : {};

    // Pickup provider list from all connected vehicles
    for (const h of homes) {
      if (!h.providerData.invalid_token && h.providerData.token) {
        providers[h.providerData.token.access_token] = h.providerData.token;
      }
    }

    this.allProviderHomes = [];
    for (const token of Object.values(providers)) {
      // TODO: break this out into a helper function ?
      try {
        for (const v of (await getHomes(token)) as {
          appNickname: string;
          id: string;
          type: string;
        }[]) {
          let entry = this.allProviderHomes.find(f => f.id === v.id);
          if (!entry) {
            entry = {
              name: "home", // v.type === "HOUSE" ?
              id: v.id,
              nickname: v.appNickname,
              tibber_token: token,
              controlled: false
            } as TibberNewListEntry;
            this.allProviderHomes.push(entry);
          }
          for (const f of homes) {
            if (f.providerData.home === v.id) {
              entry.controlled = true;
              if (
                !f.providerData.token ||
                f.providerData.invalid_token ||
                f.providerData.token !== token
              ) {
                log(
                  LogLevel.Info,
                  `Home ${
                    f.id
                  } did not have the correct token defined in providerData`
                );
                await apollo.updateLocation({
                  id: f.id,
                  providerData: {
                    provider: provider.name,
                    token,
                    invalid_token: null
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
    if (this.allProviderHomes.length === 0) {
      this.showTokenForm = true;
    }
  }

  async newProvider(token: string) {
    this.showTokenForm = false;
    this.loadTibberHomes(token);
  }

  async selectHome(home: TibberNewListEntry) {
    this.loading = true;
    await apollo.newLocation({
      name: home.name,
      geoLocation: {
        latitude: Number(this.$route.query.lat),
        longitude: Number(this.$route.query.long)
      },
      geoFenceRadius: 250,
      providerData: {
        provider: provider.name,
        home: home.id,
        token: home.tibber_token
      } as TibberProviderData
    });
    this.loading = false;
    this.$router.push("/");
  }
}
</script>

<style></style>
