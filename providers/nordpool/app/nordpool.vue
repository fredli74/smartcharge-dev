<template>
  <div class="vga-limit" style="margin:0 auto">
    <template v-if="page === 'new'">
      <v-form ref="form">
        <v-card-text>
          <v-text-field
            v-model="name.value"
            :loading="name.loading"
            :error="name.error !== undefined"
            :error-messages="name.error"
            label="Location name"
          ></v-text-field
        ></v-card-text>
        <v-card-text>
          <v-select
            v-model="area.value"
            :loading="area.loading"
            :disabled="area.loading"
            :error="area.error !== undefined"
            :error-messages="area.error"
            :items="nordpoolAreas"
            item-text="area"
            item-value="price_code"
            label="Nordpool Area Code"
            outlined
            hint="show map"
            persistent-hint
            ><template v-slot:message="{ message, key }">
              <a
                :key="key"
                href="https://www.nordpoolgroup.com/maps#/nordic"
                target="_blank"
                >{{ message }}</a
              >
            </template></v-select
          ></v-card-text
        >
        <v-card-actions class="justify-center">
          <v-btn
            :disabled="button.disabled || button.loading"
            :loading="button.loading"
            color="success"
            class="mr-4"
            @click="submit"
          >
            Add Location
          </v-btn></v-card-actions
        >
      </v-form>
    </template>
  </div>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import apollo from "@app/plugins/apollo";
import { ProviderVuePage } from "@providers/provider-app";
import provider, { NordpoolProviderData } from "..";
import { Location } from "@server/gql/location-type";

interface NordpoolArea {
  price_code: string;
  area: string;
}
interface InputState {
  disabled: boolean;
  loading: boolean;
  value: any | undefined;
  error: string | undefined;
}
@Component({ components: {} })
export default class NordpoolVue extends Vue {
  @Prop({ default: "view" })
  page?: ProviderVuePage;

  // REACTIVE PROPERTIES
  area!: InputState;
  name!: InputState;
  button!: InputState;
  nordpoolAreas!: NordpoolArea[];
  knownLocations!: Location[];

  // HOOKS
  data() {
    // data() hook for undefined values
    return {
      area: {
        disabled: false,
        loading: false,
        value: undefined,
        error: undefined
      },
      name: {
        disabled: false,
        loading: false,
        value: undefined,
        error: undefined
      },
      button: { disabled: false, loading: false },
      nordpoolAreas: [],
      knownLocations: []
    };
  }

  async loadAreas() {
    this.area.loading = true;
    this.nordpoolAreas = ((await apollo.providerQuery(provider.name, {
      query: "areas"
    })) as NordpoolArea[]).sort((a, b) => (a.area > b.area ? 1 : -1));
    this.area.loading = false;
  }
  async loadNames() {
    this.name.loading = true;
    this.knownLocations = await apollo.getLocations();
    // Default names
    if (
      this.knownLocations.findIndex(f => f.name.toLowerCase() === "home") < 0
    ) {
      this.name.value = "home";
    } else if (
      this.knownLocations.findIndex(f => f.name.toLowerCase() === "work") < 0
    ) {
      this.name.value = "work";
    }
    this.name.loading = false;
  }

  async mounted() {
    await Promise.all([this.loadAreas(), this.loadNames()]);
    this.button.disabled = false;
  }

  // ACTIONS
  async submit() {
    if (typeof this.name.value !== "string" || this.name.value.length < 2) {
      this.name.error = "Minimum of 2 characters";
    } else if (
      this.knownLocations.findIndex(
        f => f.name.toLowerCase() === this.name.value.toLowerCase()
      ) >= 0
    ) {
      this.name.error = "You already have a location with that name";
    } else {
      this.name.error = undefined;
    }

    if (this.area.value === undefined) {
      this.area.error = "Required";
    } else {
      this.area.error = undefined;
    }

    if (this.name.error || this.area.error) {
      return false;
    } else {
      this.button.loading = true;
      await apollo.providerMutate("nordpool", {
        mutation: "newLocation",
        name: this.name.value,
        latitude: Number(this.$route.query.lat),
        longitude: Number(this.$route.query.long),
        price_code: this.area.value,
        provider_data: { currency: "SEK" } as NordpoolProviderData
      });
      this.button.loading = false;
      this.$router.push("/");
    }
  }
}
</script>

<style></style>
