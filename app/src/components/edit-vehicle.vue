<template>
  <v-form ref="form">
    <v-row class="mb-n5">
      <v-col cols="12" sm="8">
        <v-text-field
          v-model="name"
          :rules="[nameRules]"
          label="Vehicle name"
          required
          :loading="saving.name"
        ></v-text-field>
      </v-col>
      <v-col cols="6" sm="4">
        <v-text-field
          v-model="maximumLevel"
          :rules="[maximumLevelRules]"
          label="Maximum charge level"
          type="number"
          min="50"
          max="100"
          suffix="%"
          :loading="saving.maximumLevel"
        >
          <template #append-outer>
            <v-tooltip bottom max-width="18rem">
              <template #activator="{ on }">
                <v-icon v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              To avoid battery degradation, do not charge above this level,
              unless a trip or manual charge is scheduled. (Recommended 90%)
            </v-tooltip>
          </template>
        </v-text-field>
      </v-col>
    </v-row>
    <v-row align="center" justify-sm="space-around" class="mb-5">
      <v-col cols="12" sm="auto" align-self-sm="center">
        <v-switch
          v-model="auto_hvac"
          color="primary"
          inset
          label="Trip Preconditioning"
          persistent-hint
          hint="Schedule preconditioning for trips"
          :loading="saving.auto_hvac"
        ></v-switch>
      </v-col>
    </v-row>
    <v-divider></v-divider>
    <v-list v-if="locationSettings().length > 0" two-line subheader>
      <v-subheader class="px-0 mb-n3">Location settings</v-subheader>

      <EditVehicleLocationSettings
        v-for="l in locationSettings()"
        :key="l.settings.location"
        :name="l.name"
        :settings="l.settings"
        :vehicle="vehicle"
      ></EditVehicleLocationSettings>
    </v-list>
    <v-divider></v-divider>
    <v-row class="mt-3" justify="space-between">
      <v-col cols="auto">
        <v-switch
          v-model="disabled"
          hide-details="true"
          class="mt-0"
          color="deep-orange accent-4"
          inset
          label="Disable"
          :loading="saving.disabled"
        >
          <template v-if="disabled && error" #label>
            <div class="deep-orange--text text--accent-4">
              Disabled due to "{{ error }}"
            </div>
          </template>
          <template v-else-if="disabled" #label>
            <div class="deep-orange--text text--accent-4">
              Disabled information polling and charge control!
            </div>
          </template>
        </v-switch>
      </v-col>
      <v-spacer></v-spacer>
      <v-col cols="auto">
        <RemoveDialog
          :id="vehicle.id"
          label="vehicle"
          @action="doConfirm"
        ></RemoveDialog>
      </v-col>
    </v-row>
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
} from "@shared/sc-schema";
import { DefaultVehicleLocationSettings } from "@shared/sc-utils";
import { UpdateVehicleParams } from "@shared/sc-client";

@Component({
  components: { EditVehicleLocationSettings, RemoveDialog },
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
        auto_port: false,
        disabled: false,
      },
    };
  }
  async created() {}

  nameRules(value: string) {
    return (value && value.length) || `Required`;
  }

  maximumLevelRules(value: string) {
    const v = parseInt(value) || 0;
    if (v < 50 || v > 100) {
      return `allowed range 50% - 100%`;
    }
    return true;
  }

  locationSettings(): any[] {
    return (
      (this.locations &&
        this.locations
          .filter((l) => l.ownerID === this.vehicle.ownerID)
          .map((l) => {
            const settings: GQLVehicleLocationSetting =
              (this.vehicle.locationSettings &&
                this.vehicle.locationSettings.find(
                  (f) => f.locationID === l.id
                )) ||
              DefaultVehicleLocationSettings(l.id);
            return {
              name: l.name,
              settings,
            };
          })) ||
      []
    );
  }

  async doConfirm(code: string) {
    await apollo.removeVehicle(this.vehicle.id, code);
    this.$emit("refresh");
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
  get disabled(): boolean {
    return this.vehicle.providerData && this.vehicle.providerData.disabled;
  }
  set disabled(value: boolean) {
    if (value) {
      this.vehicle.providerData.disabled = true;
    } else {
      this.vehicle.providerData.disabled = null;
      this.vehicle.providerData.error = null;
    }
    this.save("disabled");
  }
  get error(): string {
    return this.vehicle.providerData && this.vehicle.providerData.error;
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
        const update: UpdateVehicleParams = {
          id: this.vehicle.id,
          providerData: {},
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
        if (this.saving["disabled"]) {
          update.providerData.disabled = this.vehicle.providerData.disabled;
          update.providerData.error = this.vehicle.providerData.error;
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
