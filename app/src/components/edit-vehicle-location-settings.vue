<template>
  <v-form ref="form">
    <v-row>
      <v-col cols="12" sm="5" md="6" class="mt-2">
        <v-list-item-title>{{ name }}</v-list-item-title>
        <v-list-item-subtitle
          class="font-light overline caption secondary--text text--lighten-2"
        >
          ({{ settings.locationID }})
        </v-list-item-subtitle>
      </v-col>
      <v-spacer />
      <v-col cols="6" sm="3" md="3">
        <v-text-field
          v-model="directLevel"
          :rules="[directLevelRules]"
          label="Direct charge level"
          placeholder=" "
          type="number"
          min="5"
          max="50"
          suffix="%"
          :loading="saving.directLevel"
        >
          <template #append-outer>
            <v-tooltip bottom max-width="18rem">
              <template #activator="{ on }">
                <v-icon v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              Charge directly to this level when plugged in. It should be enough
              to take you to the nearest super charger, or emergency room.
            </v-tooltip>
          </template>
        </v-text-field>
      </v-col>
      <v-col cols="6" sm="4" md="3">
        <v-combobox
          v-model="goal"
          :items="goalCBList"
          :rules="[targetRules]"
          label="Smart charge goal"
          placeholder=" "
          :suffix="typeof goal === 'string' ? '%' : ''"
          :loading="saving.goal"
        >
          <template #append-outer>
            <v-tooltip bottom max-width="18rem">
              <template #activator="{ on }">
                <v-icon v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              Set the smart charge focus from low cost, that may only fill up on
              days when prices are low, to full charge, that fills up every
              time. (Recommended Balanced)
            </v-tooltip>
          </template>
        </v-combobox>
      </v-col>

      <v-col v-if="false" cols="auto" class="pa-0">
        <v-list-item-action class="ma-0">
          <v-btn-toggle
            v-model="focus"
            active-class="selected-charge"
            color="primary"
            label="hej"
            mandatory
          >
            <v-btn small>Low Cost</v-btn>
            <v-btn small>Balanced</v-btn>
            <v-btn small>Full Charge</v-btn>
          </v-btn-toggle>
        </v-list-item-action>
      </v-col>
    </v-row>
  </v-form>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import deepmerge from "deepmerge";
import apollo from "@app/plugins/apollo";
import { GQLVehicle, GQLVehicleLocationSetting } from "@shared/sc-schema";
import { SmartChargeGoal } from "@shared/sc-types";
import { UpdateVehicleParams } from "@shared/sc-client";

@Component({})
export default class EditVehicle extends Vue {
  @Prop({ type: Object, required: true }) declare readonly vehicle: GQLVehicle;
  @Prop({ type: String, required: true }) declare readonly name: String;
  @Prop({ type: Object, required: true }) declare readonly settings: GQLVehicleLocationSetting;

  saving!: { [key: string]: boolean };
  goalCBList!: { text: string; value: string }[];
  data() {
    return {
      saving: {
        directLevel: false,
        goal: false,
      },
      goalCBList: [
        { text: "Low cost", value: SmartChargeGoal.Low },
        { text: "Balanced", value: SmartChargeGoal.Balanced },
        { text: "Full charge", value: SmartChargeGoal.Full },
        { text: "Custom", value: "%" },
      ],
    };
  }

  directLevelRules(value: string) {
    const v = parseInt(value) || 0;
    if (v < 5 || v > 50) {
      return `allowed range 5% - 50%`;
    }
    return true;
  }

  targetRules(value: string | any) {
    if (typeof value === "string") {
      const v = parseInt(value) || 0;
      if (v < this.settings.directLevel || v > this.vehicle.maximumLevel) {
        return `allowed range ${this.settings.directLevel}% - ${this.vehicle.maximumLevel}%`;
      }
    }
    return true;
  }

  get directLevel(): string {
    return this.settings.directLevel.toString();
  }
  set directLevel(value: string) {
    const v = parseInt(value);
    if (v) {
      this.settings.directLevel = v;
      this.save("directLevel");
    }
  }
  get goal(): any {
    const preset = this.goalCBList.find((f) => f.value === this.settings.goal);
    if (preset) {
      return preset;
    }
    return this.settings.goal;
  }
  set goal(value: any) {
    if (typeof value !== "string" && value.value === "%") {
      const defaultGoal =
        Math.round(
          (this.settings.directLevel + this.vehicle.maximumLevel) / 10
        ) * 5;
      this.settings.goal = defaultGoal.toString();
    } else {
      this.settings.goal = value;
    }
    this.save("goal");
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
        const goal = this.settings.goal as any;
        const update: UpdateVehicleParams = {
          id: this.vehicle.id,
          locationSettings: [
            {
              locationID: this.settings.locationID,
              directLevel: this.settings.directLevel,
              goal: goal.value || goal,
            } as GQLVehicleLocationSetting,
          ],
        };

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
