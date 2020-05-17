<template>
  <v-form ref="form">
    <v-row>
      <v-col cols="12" md="9">
        <v-text-field
          v-model="name"
          :rules="[v => v.length > 0 || 'Required']"
          label="Vehicle name"
          required
          :loading="saving.name"
        ></v-text-field>
      </v-col>
      <v-col cols="6" sm="5" md="3">
        <v-text-field
          v-model="maximumLevel"
          :rules="[v => (v >= 50 && v <= 100) || 'allowed range 50% - 100%']"
          label="Maximum charge level"
          type="number"
          min="50"
          max="100"
          suffix="%"
          :loading="saving.maximumLevel"
        >
          <template v-slot:append-outer>
            <v-tooltip bottom max-width="18rem">
              <template v-slot:activator="{ on }">
                <v-icon v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              To avoid battery degradation, do not charge above this level,
              unless a trip or manual charge is scheduled. (Recommended 90%)
            </v-tooltip>
          </template>
        </v-text-field>
      </v-col>
    </v-row>
    <v-divider></v-divider>
    <v-list v-if="locationSettings().length > 0" two-line subheader>
      <v-subheader class="px-0 mb-n3"
        >Location settings<v-tooltip right max-width="20rem">
          <template v-slot:activator="{ on }">
            <v-icon class="float-right mx-4" v-on="on"
              >mdi-help-circle-outline</v-icon
            >
          </template>
          Adjust smart charge focus from low cost, that tries to only charge at
          low prices, to full charge that fills up every time.
        </v-tooltip>
      </v-subheader>

      <EditVehicleLocationSettings
        v-for="l in locationSettings()"
        :key="l.settings.location"
        :name="l.name"
        :settings="l.settings"
        :vehicle="vehicle"
      >
      </EditVehicleLocationSettings>
    </v-list>
    <v-divider></v-divider>
    <v-row align="center" justify="space-around">
      <v-col cols="auto" align-self="center">
        <v-switch
          v-model="auto_port"
          color="primary"
          inset
          label="Auto charge port"
          persistent-hint
          hint="Open after parking if charge is needed"
          :loading="saving.auto_port"
        ></v-switch
      ></v-col>
      <v-col cols="auto" align-self="center"
        ><v-switch
          v-model="auto_hvac"
          color="primary"
          inset
          label="Trip Climate Control"
          persistent-hint
          hint="Turn on before scheduled trip"
          :loading="saving.auto_hvac"
        ></v-switch>
      </v-col>
    </v-row>
    <v-row justify="center">
      <RemoveDialog
        :id="vehicle.id"
        label="vehicle"
        @action="doConfirm"
      ></RemoveDialog>
    </v-row>
    {{ locations }}
    {{ locationSettings() }}
  </v-form>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import EditVehicleLocationSettings from "@app/components/edit-vehicle-location-settings.vue";
import RemoveDialog from "@app/components/remove-dialog.vue";
import deepmerge from "deepmerge";
import apollo from "@app/plugins/apollo";
import equal from "fast-deep-equal";
import {
  GQLVehicle,
  GQLLocation,
  GQLVehicleLocationSetting,
  GQLUpdateVehicleInput
} from "@shared/sc-schema";
import { SmartChargeGoal } from "@shared/sc-types";
import { DEFAULT_DIRECTLEVEL } from "@shared/smartcharge-defines";

function DefaultVehicleLocationSettings(
  location_uuid: string
): GQLVehicleLocationSetting {
  // NOTICE: There is a mirrored function for server side in db-interface.ts
  return {
    locationID: location_uuid,
    directLevel: DEFAULT_DIRECTLEVEL,
    goal: SmartChargeGoal.Balanced
  };
}

@Component({
  components: { EditVehicleLocationSettings, RemoveDialog }
})
export default class EditVehicle extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: GQLVehicle;
  @Prop({ type: Array, required: true }) readonly locations!: GQLLocation[];

  saving!: { [key: string]: boolean };

  data() {
    return {
      saving: {
        name: false,
        maximumLevel: false,
        auto_hvac: false,
        auto_port: false
      }
    };
  }
  async created() {}

  locationSettings(): any[] {
    return (
      (this.locations &&
        this.locations
          .filter(l => l.ownerID === this.vehicle.ownerID)
          .map(l => {
            const settings: GQLVehicleLocationSetting =
              (this.vehicle.locationSettings &&
                this.vehicle.locationSettings.find(
                  f => f.locationID === l.id
                )) ||
              DefaultVehicleLocationSettings(l.id);
            return {
              name: l.name,
              settings
            };
          })) ||
      []
    );
  }

  async doConfirm(code: string) {
    await apollo.removeVehicle(this.vehicle.id, code);
  }

  get name(): string {
    return this.vehicle.name;
  }
  set name(value: string) {
    this.vehicle.name = value;
    this.save("name");
  }
  get maximumLevel(): string {
    return this.vehicle.maximumLevel.toString();
  }
  set maximumLevel(value: string) {
    const v = parseInt(value);
    if (v) {
      this.vehicle.maximumLevel = v;
      this.save("maximumLevel");
    }
  }
  get auto_hvac(): boolean {
    return this.vehicle.providerData && this.vehicle.providerData.auto_hvac;
  }
  set auto_hvac(value: boolean) {
    this.vehicle.providerData.auto_hvac = value;
    this.save("auto_hvac");
  }
  get auto_port(): boolean {
    return this.vehicle.providerData && this.vehicle.providerData.auto_port;
  }
  set auto_port(value: boolean) {
    this.vehicle.providerData.auto_port = value;
    this.save("auto_port");
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
        const update: GQLUpdateVehicleInput = {
          id: this.vehicle.id,
          providerData: {}
        };
        if (this.saving["name"]) {
          update.name = this.vehicle.name;
        }
        if (this.saving["maximumLevel"]) {
          update.maximumLevel = this.vehicle.maximumLevel;
        }
        if (this.saving["auto_hvac"]) {
          update.providerData.auto_hvac = this.vehicle.providerData.auto_hvac;
        }
        if (this.saving["auto_port"]) {
          update.providerData.auto_port = this.vehicle.providerData.auto_port;
        }
        if (equal(update.providerData, {})) {
          delete update.providerData;
        }

        this.clearSaving = deepmerge(this.clearSaving, this.saving);

        await apollo.updateVehicle(update);

        for (let [key, value] of Object.entries(this.clearSaving)) {
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
