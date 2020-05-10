<template>
  <v-dialog v-model="dialog" max-width="410">
    <template v-slot:activator="{ on }">
      <v-hover v-slot:default="{ hover }">
        <v-btn small :outlined="!hover" color="error" v-on="on">remove</v-btn>
      </v-hover>
    </template>
    <v-card>
      <v-progress-linear
        value="100"
        height="10"
        striped
        color="red"
      ></v-progress-linear>

      <v-card-title class="headline"
        ><v-icon class="mr-3" color="red" x-large>mdi-alert</v-icon>Are you
        sure?</v-card-title
      >
      <v-card-text class="font-weight-bold"
        >All information regarding this {{ label }} will be removed.
        <span class="font-weight-black"
          >This can not be undone!</span
        ></v-card-text
      >
      <v-card-text
        >To confirm, type the code
        <span class="text-uppercase font-weight-black monospace">{{
          publicID
        }}</span>
        in the text box.
      </v-card-text>
      <v-text-field
        v-model="confirmCode"
        class="mx-6"
        label="confirmation code"
        :rules="[v => !v || valid || 'incorrect code']"
        dense
        outlined
      ></v-text-field>
      <v-card-actions align="center" class="pb-4">
        <v-spacer></v-spacer>
        <v-btn color="green darken-2" text @click="doCancel">back</v-btn>
        <v-btn
          color="red darken-1"
          :text="!valid"
          :disabled="!valid"
          :dark="valid"
          @click="doConfirm"
          >remove</v-btn
        >
        <v-spacer></v-spacer>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts">
import { Component, Vue, Prop } from "vue-property-decorator";
import { makePublicID } from "@shared/utils";

@Component({ components: {} })
export default class RemoveDialog extends Vue {
  @Prop({ type: String, required: true }) readonly label!: string;
  @Prop({ type: String, required: true }) readonly id!: string;

  dialog!: boolean;
  confirmCode!: string;
  data() {
    return {
      dialog: false,
      confirmCode: ""
    };
  }
  get publicID(): string {
    return makePublicID(this.id).toUpperCase();
  }
  get valid(): boolean {
    return this.confirmCode.toUpperCase() === this.publicID;
  }
  doCancel() {
    this.dialog = false;
    this.confirmCode = "";
  }
  doConfirm() {
    this.$emit("action", this.confirmCode);
    this.dialog = false;
  }
}
</script>
<style>
.v-application .monospace {
  /*letter-spacing: 0.14em !important;*/
  font-size: 1rem;
  font-variant-numeric: slashed-zero;
  font-family: "Roboto Mono", monospace;
}
</style>
