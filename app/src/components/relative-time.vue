<template>
  <span>{{ relativeTime }}</span>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";

@Component({ components: {} })
export default class RelativeTime extends Vue {
  @Prop(Date) readonly time!: Date;
  timer?: any;
  relativeTime!: string;

  data() {
    return { relativeTime: "" };
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
      return "";
    }

    let nextInterval = 1000;
    let span = (Date.now() - this.time.getTime()) / 1e3;
    this.relativeTime = ((span: number): string => {
      span = Math.trunc(span);
      if (span < 4) {
        return `now`;
      }
      if (span < 120) {
        return `${span} seconds ago`;
      }
      nextInterval *= 10;
      span = Math.trunc(span / 60);
      if (span < 120) {
        return `${span} minutes ago`;
      }
      nextInterval *= 10;
      span = Math.trunc(span / 60);
      if (span < 24) {
        return `${span} hours ago`;
      }
      nextInterval *= 10;
      span = Math.trunc(span / 24);
      return `${span} day${span === 1 ? "" : "s"} ago`;
    })(span);
    this.timer = setTimeout(this.updateRelative, nextInterval);
  }
}
</script>

<style></style>
