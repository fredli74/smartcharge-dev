<template>
  <v-card-actions
    id="vehicle-actions"
    v-resize="onResize"
    class="justify-center"
  >
    <v-dialog
      v-model="dialogShow"
      :fullscreen="$vuetify.breakpoint.xsOnly"
      max-width="600px"
      ><v-card>
        <v-toolbar flat dark color="primary">
          <v-btn icon @click="dialogShow = false">
            <v-icon>{{
              $vuetify.breakpoint.xsOnly ? "mdi-chevron-left" : "mdi-close"
            }}</v-icon>
          </v-btn>
          <v-toolbar-title>{{ dialogTitle }}</v-toolbar-title>
        </v-toolbar>
        <component
          :is="dialogContent"
          :vehicle="vehicle"
          @changed="queueSave"
        />
      </v-card>
    </v-dialog>

    <v-tooltip v-if="!isSleeping" top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          outlined
          color=""
          :loading="refreshLoading"
          :disabled="!Boolean(vehicle.serviceID)"
          v-on="on"
          @click="refreshClick()"
          ><v-icon :large="!smallButton">mdi-refresh</v-icon></v-btn
        >
      </template>
      <span>Update</span>
    </v-tooltip>
    <v-tooltip v-else top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          outlined
          color=""
          :loading="refreshLoading"
          :disabled="!Boolean(vehicle.serviceID)"
          v-on="on"
          @click="refreshClick()"
          ><v-icon :large="!smallButton">mdi-sleep-off</v-icon></v-btn
        >
      </template>
      <span>Wake Up</span>
    </v-tooltip>
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          :outlined="!vehicle.climateControl"
          :color="vehicle.climateControl ? 'success darken-1' : ''"
          :loading="hvacLoading"
          :disabled="!Boolean(vehicle.serviceID)"
          v-on="on"
          @click="hvacClick()"
          ><v-icon :large="!smallButton"
            >mdi-fan{{ vehicle.climateControl ? "" : "-off" }}</v-icon
          ></v-btn
        >
      </template>
      <span>Climate Control</span>
    </v-tooltip>

    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <div v-on="on">
          <v-btn
            depressed
            fab
            :small="smallButton"
            :dark="Boolean(manualChargeColor)"
            :outlined="!Boolean(manualChargeColor)"
            :color="manualChargeColor"
            :disabled="!Boolean(vehicle.isConnected)"
            @click="chargeClick()"
            ><v-icon :large="!smallButton">mdi-lightning-bolt</v-icon></v-btn
          >
        </div>
      </template>
      <span v-if="Boolean(vehicle.isConnected)">Charge Control</span>
      <span v-else>Not connected</span>
    </v-tooltip>
    <v-tooltip top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          :outlined="!Boolean(vehicle.tripSchedule)"
          :color="Boolean(vehicle.tripSchedule) ? 'success darken-1' : ''"
          v-on="on"
          @click="tripClick()"
          ><v-icon :large="!smallButton">mdi-calendar-clock</v-icon></v-btn
        >
      </template>
      <span>Trip</span>
    </v-tooltip>
    <v-tooltip v-if="false" top>
      <template v-slot:activator="{ on }">
        <v-btn
          depressed
          fab
          :small="smallButton"
          :outlined="!Boolean(vehicle.pausedUntil)"
          :color="Boolean(vehicle.pausedUntil) ? 'warning' : ''"
          v-on="on"
          @click="pauseClick()"
          ><v-icon :large="!smallButton">mdi-pause</v-icon></v-btn
        >
      </template>
      <span>Pause Smart Charging</span>
    </v-tooltip>
  </v-card-actions>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import { gql } from "apollo-boost";
import { AgentAction } from "@providers/provider-agent";
import apollo from "@app/plugins/apollo";
import { delay } from "@shared/utils";
import { VueConstructor } from "vue";
import VehicleSettings from "./vehicle-settings.vue";
import eventBus, { BusEvent } from "@app/plugins/event-bus";
import deepmerge from "deepmerge";
import VehicleCharge from "./vehicle-charge.vue";
import VehicleTrip from "./vehicle-trip.vue";
import { GQLAction, GQLVehicle, GQLSchduleType } from "@shared/sc-schema";
import { scheduleMap } from "@shared/sc-utils";

@Component({
  components: {
    VehicleCharge,
    VehicleTrip
  },
  apollo: {
    $subscribe: {
      actions: {
        query: gql`
          subscription ActionSubscription(
            $providerName: String
            $serviceID: ID
          ) {
            actionSubscription(
              providerName: $providerName
              serviceID: $serviceID
            ) {
              actionID
              serviceID
              providerName
              action
              data
            }
          }
        `,
        variables() {
          return {
            serviceID: this.$props.vehicle.serviceID
          };
        },
        result({ data }: any) {
          const action = data.actionSubscription as GQLAction;
          if (action.data.id === this.$route.params.id && action.data.error) {
            // Only subscribing for errors to be honest, all other actions
            // are checked in other ways
            eventBus.$emit(BusEvent.AlertWarning, action.data.error);
            if (action.action === AgentAction.Refresh) {
              this.$data.refreshLoading = false;
            }
            if (action.action === AgentAction.ClimateControl) {
              this.$data.hvacLoading = false;
            }
          }
        }
      }
    }
  }
})
export default class VehicleActions extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: GQLVehicle;

  changed!: boolean;
  saving!: boolean;
  refreshLoading!: boolean;
  hvacLoading!: boolean;
  smallButton!: boolean;
  dialogShow!: boolean;
  dialogContent?: VueConstructor<Vue>;
  dialogTitle?: string;

  data() {
    return {
      saving: false,
      changed: false,
      refreshLoading: false,
      hvacLoading: false,
      smallButton: false,
      dialogShow: false,
      dialogContent: undefined,
      dialogTitle: undefined,
      chargePopup: false
    };
  }
  mounted() {
    // this.chargeClick();
  }
  onResize() {
    this.smallButton = window.innerWidth > 600 && window.innerWidth < 960;
  }
  get isSleeping() {
    return (
      this.vehicle &&
      (this.vehicle!.status.toLowerCase() === "offline" ||
        this.vehicle!.status.toLowerCase() === "sleeping")
    );
  }

  get manualChargeColor() {
    const schedule = scheduleMap(this.vehicle.schedule);
    const manual = schedule[GQLSchduleType.Manual];
    if (manual) {
      if (manual.level === 0) {
        return "red accent-4";
      } else {
        return "success darken-1";
      }
    }
    return undefined;
  }

  async refreshClick() {
    if (this.vehicle && this.vehicle.serviceID) {
      this.refreshLoading = true;
      apollo.action(this.vehicle.serviceID, AgentAction.Refresh, {
        id: this.vehicle.id
      });
      const was = this.vehicle.updated;
      const maxWait = Date.now() + 5 * 60e3;
      while (this.vehicle.updated === was) {
        await delay(1000);
        if (Date.now() > maxWait) {
          break;
        }
      }
      this.refreshLoading = false;
    }
  }
  async hvacClick() {
    if (this.vehicle && this.vehicle.serviceID) {
      this.hvacLoading = true;
      if (this.isSleeping) this.refreshLoading = true;
      const want = !this.vehicle.climateControl;
      apollo.action(this.vehicle.serviceID, AgentAction.ClimateControl, {
        id: this.vehicle.id,
        enable: want
      });
      const maxWait = Date.now() + 5 * 60e3;
      while (this.vehicle.climateControl !== want) {
        await delay(1000);
        if (Date.now() > maxWait) {
          break;
        }
      }
      this.refreshLoading = false;
      this.hvacLoading = false;
    }
  }

  tripClick() {
    this.dialogShow = true;
    this.dialogTitle = "Trip";
    this.dialogContent = VehicleTrip;
    return true;
  }
  chargeClick() {
    this.dialogShow = true;
    this.dialogTitle = "Charge control";
    this.dialogContent = VehicleCharge;
    return true;
  }
  settingsClick() {
    this.dialogShow = true;
    this.dialogTitle = "Settings";
    this.dialogContent = VehicleSettings;
    return true;
  }

  saveTimer?: any;
  unsavedData?: any = {};
  queueSave(delay: number, data: any) {
    console.debug("Queue:", data);
    this.unsavedData = deepmerge(this.unsavedData, data);
    this.changed = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.save();
      this.saveTimer = undefined;
    }, delay);
  }
  async save() {
    console.debug("Save:", this.unsavedData);
    this.saving = true;
    this.changed = false;
    await apollo.updateVehicle({
      id: this.vehicle.id,
      ...this.unsavedData
    });
    this.saving = false;
  }
}
</script>
<style>
.time-picker-column-item-text {
  font-size: 18px !important;
}
.datepicker-day-text {
  font-size: 18px !important;
}
#vehicle-actions > * {
  margin-left: 14px;
}
#vehicle-actions button {
  vertical-align: top;
}
</style>
