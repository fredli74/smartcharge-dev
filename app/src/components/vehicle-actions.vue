<template>
  <v-card-actions id="vehicle-actions" v-resize="onResize" class="justify-center">
    <v-dialog v-model="dialogShow" :fullscreen="$vuetify.breakpoint.xsOnly" max-width="600px">
      <v-card>
        <v-toolbar flat dark color="primary">
          <v-btn icon @click="dialogShow = false">
            <v-icon>
              {{ $vuetify.breakpoint.xsOnly ? "mdi-chevron-left" : "mdi-close" }}
            </v-icon>
          </v-btn>
          <v-toolbar-title>{{ dialogTitle }}</v-toolbar-title>
        </v-toolbar>
        <component :is="dialogContent" :vehicle="vehicle" @changed="queueSave" />
      </v-card>
    </v-dialog>

    <v-tooltip top :disabled="disableTooltips">
      <template #activator="{ on }">
        <div v-on="on">
          <v-btn depressed fab :small="smallButton" :dark="manualChargeState.dark" :outlined="manualChargeState.outlined"
            :color="manualChargeState.color" @click="chargeClick()"
          >
            <v-icon :large="!smallButton">
              {{ !vehicle.isConnected && vehicle.locationID ? "mdi-power-plug-off" : "mdi-lightning-bolt" }}
            </v-icon>
          </v-btn>
        </div>
      </template>
      <span>{{ manualChargeState.tooltip }}</span>
    </v-tooltip>
    <v-tooltip top :disabled="disableTooltips">
      <template #activator="{ on }">
        <v-btn depressed fab :small="smallButton" :outlined="!hasSchedule"
          :color="hasSchedule ? vehicle.isConnected ? 'success darken-1' : 'warning' : ''" v-on="on"
          @click="scheduleClick()"
        >
          <v-icon :large="!smallButton">mdi-calendar-clock</v-icon>
        </v-btn>
      </template>
      <span>Schedule</span>
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
import eventBus, { BusEvent } from "@app/plugins/event-bus";
import deepmerge from "deepmerge";
import VehicleCharge from "./vehicle-charge.vue";
import VehicleSchedule from "./vehicle-schedule.vue";
import { GQLAction, GQLVehicle, GQLScheduleType } from "@shared/sc-schema";
import { scheduleMap } from "@shared/sc-utils";

@Component({
  components: {
    VehicleCharge,
    VehicleSchedule,
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
            serviceID: this.$props.vehicle.serviceID,
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
        },
      },
    },
  },
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
      chargePopup: false,
    };
  }
  mounted() { }
  onResize() {
    this.smallButton = window.innerWidth > 600 && window.innerWidth < 960;
  }
  get isSleeping() {
    return (
      this.vehicle &&
      this.vehicle.status &&
      (this.vehicle.status.toLowerCase() === "offline" ||
        this.vehicle.status.toLowerCase() === "sleeping")
    );
  }
  get hasSchedule() {
    for (const s of this.vehicle.schedule) {
      if (s.level && s.time && s.type === GQLScheduleType.Trip) {
        return true;
      }
    }
    return false;
  }

  get manualChargeState() {
    const schedule = scheduleMap(this.vehicle.schedule);
    const manual = schedule[GQLScheduleType.Manual];
    if (manual) {
      if (manual.level) {
        return {
          outlined: false,
          dark: true,
          color: this.vehicle.isConnected ? "success darken-1" : "warning",
          tooltip: "Manual charge",
        };
      } else {
        return {
          outlined: false,
          dark: true,
          color: "red accent-4",
          tooltip: "No charge",
        };
      }
    } else if (!this.vehicle.isConnected && this.vehicle.locationID) {
      return {
        outlined: true,
        dark: false,
        color: "grey darken-3",
        tooltip: "Not connected",
      };
    }
    return {
      outlined: true,
      dark: false,
      color: undefined,

      tooltip: "Charge Control",
    };
  }

  async refreshClick() {
    if (this.vehicle && this.vehicle.serviceID) {
      this.refreshLoading = true;
      apollo.action(this.vehicle.serviceID, AgentAction.Refresh, {
        id: this.vehicle.id,
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
        enable: want,
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

  scheduleClick() {
    this.dialogShow = true;
    this.dialogTitle = "Schedule";
    this.dialogContent = VehicleSchedule;
    return true;
  }
  chargeClick() {
    this.dialogShow = true;
    this.dialogTitle = "Charge control";
    this.dialogContent = VehicleCharge;
    return true;
  }
  get disableTooltips(): boolean {
    return this.dialogShow;
  }

  saveTimer?: any;
  unsavedData?: any = {};
  queueSave(delay: number, data: any) {
    if (data) {
      throw "NOT USED ANYMORE?";
    }
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
      ...this.unsavedData,
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

#vehicle-actions>* {
  margin-left: 14px;
}

#vehicle-actions button {
  vertical-align: top;
}
</style>
