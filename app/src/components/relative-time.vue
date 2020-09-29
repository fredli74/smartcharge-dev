<template>
  <span :style="{ visibility: relativeShow ? 'visible' : 'hidden' }">
    <slot></slot>
    {{ relativeTime }}
    <slot name="suffix"></slot>
  </span>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import { secondsToString } from "@shared/utils";

@Component({ components: {} })
export default class RelativeTime extends Vue {
  @Prop({ type: Date, required: true }) readonly time!: Date;
  @Prop({ type: Number, default: undefined }) readonly hideBelow?: number;
  @Prop({ type: Boolean, default: false }) readonly until!: boolean;
  @Prop({ type: Number, default: 1 }) readonly units!: number;
  timer?: any;
  relativeShow!: boolean;
  relativeTime!: string;

  data() {
    return { relativeShow: false, relativeTime: "" };
  }
  mounted() {
    this.updateRelative();
  }

  @Watch("time")
  onTimeChange() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.updateRelative();
  }
  beforeDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  updateRelative() {
    if (this.time === undefined) {
      this.relativeTime = "";
    } else {
      let span = (Date.now() - this.time.getTime()) / 1e3; // seconds
      span *= this.until ? -1 : 1;
      if (this.hideBelow !== undefined && span < this.hideBelow) {
        this.relativeTime = "";
        this.relativeShow = false;
      } else {
        this.relativeTime = secondsToString(span, this.units, this.until);
        this.relativeShow = true;
      }

      const nextInterval = 1000 * Math.ceil(span / 100);
      this.timer = setTimeout(this.updateRelative, nextInterval);
    }
  }
}
</script>

<style></style>
