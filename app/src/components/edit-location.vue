<template>
  <v-form ref="form">
    <v-row>
      <v-col cols="12" md="9">
        <v-text-field
          v-model="name"
          :rules="[nameRules]"
          label="Location name"
          required
          :loading="saving.name"
        />
      </v-col>
      <v-spacer />
      <v-col cols="auto" align-self="center" />
    </v-row>
    <v-row>
      <v-col cols="12" md="9">
        <v-autocomplete
          v-model="pricelist"
          :loading="isPriceListLoading"
          :items="priceLists"
          cache-items
          label="Price list"
          placeholder="none"
        />
      </v-col>
    </v-row>
    <v-row justify="space-between">
      <v-btn
        class="float-right"
        color="primary"
        icon
        :href="mapLink"
        target="_blank"
      >
        <v-icon>mdi-map-marker</v-icon>
      </v-btn>
      <v-spacer />
      <v-col cols="auto">
        <RemoveDialog :id="location.id" label="location" @action="removeLocation" />
      </v-col>
    </v-row>
  </v-form>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import gql from "graphql-tag";

import EditVehicleLocationSettings from "@app/components/edit-vehicle-location-settings.vue";
import RemoveDialog from "@app/components/remove-dialog.vue";
import deepmerge from "deepmerge";
import equal from "fast-deep-equal";
import { GQLLocation, GQLPriceList } from "@shared/sc-schema.js";
import { UpdateLocationParams } from "@shared/sc-client.js";

@Component({
  components: { EditVehicleLocationSettings, RemoveDialog },
  apollo: {
    priceLists: {
      query: gql`
        query GetPriceLists {
          priceLists {
            id
            ownerID
            name
            isPublic
          }
        }
      `,
      update: (data) =>
        data.priceLists.map((f: any) => ({ text: f.name, value: f.id })),
    },
  },
})
export default class EditLocation extends Vue {
  @Prop({ type: Object, required: true }) declare readonly location: GQLLocation;

  saving!: { [key: string]: boolean };
  priceLists?: GQLPriceList[];

  data() {
    return {
      priceLists: undefined,
      loading: false,
      select: null,

      saving: {
        name: false,
        pricelist: false,
      },
    };
  }
  async created() {}

  async removeLocation(code: string) {
    await this.$scClient.removeLocation(this.location.id, code);
    this.$emit("refresh");
  }

  get isPriceListLoading() {
    return this.$apollo.queries.priceLists.loading || this.saving.pricelist;
  }

  nameRules(value: string) {
    if (value && value.length > 0) {
      return true;
    }
    return `Required`;
  }
  get name(): string {
    return this.location.name;
  }
  set name(value: string) {
    this.location.name = value;
    this.save("name");
  }
  get mapLink(): string {
    return `https://www.google.com/maps/search/?api=1&query=${this.location.geoLocation.latitude},${this.location.geoLocation.longitude}`;
  }

  get pricelist(): string {
    return (this.location.priceList && this.location.priceList.id) || "";
  }
  set pricelist(value: string) {
    this.location.priceListID = value;
    this.save("pricelist");
  }

  debounceTimer?: any;
  touchedFields: any = {};
  clearSaving: any = {};
  async save(field: string) {
    delete this.clearSaving[field];
    this.$set(this.saving, field, true);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(async () => {
      const form: any = this.$refs.form;
      if (form.validate && form.validate()) {
        const update: UpdateLocationParams = {
          id: this.location.id,
        };
        if (this.saving["name"]) {
          update.name = this.location.name;
        }
        if (this.saving["pricelist"]) {
          update.priceListID = this.location.priceListID;
        }
        if (equal(update.providerData, {})) {
          delete update.providerData;
        }

        this.clearSaving = deepmerge(this.clearSaving, this.saving);

        await this.$scClient.updateLocation(update);

        for (const [key, value] of Object.entries(this.clearSaving)) {
          if (value) {
            this.$set(this.saving, key, false);
          }
        }
      }
    }, 800);
  }
}
</script>
<style></style>
