<template>
  <div class="vdatetime">
    <slot name="before"></slot>
    <input
      :id="inputId"
      class="vdatetime-input"
      :class="inputClass"
      type="text"
      :value="inputValue"
      v-bind="$attrs"
      v-on="$listeners"
      @click="open"
      @focus="open"
    />
    <slot name="after"></slot>
    <transition-group name="vdatetime-fade" tag="div">
      <div
        v-if="isOpen"
        key="overlay"
        class="vdatetime-overlay"
        @click.self="cancel"
      ></div>
      <datetime-popup
        v-if="isOpen"
        key="popup"
        :type="type"
        :datetime="popupDate"
        :hour-step="hourStep"
        :minute-step="minuteStep"
        :min-datetime="popupMinDatetime"
        :max-datetime="popupMaxDatetime"
        :auto="auto"
        :week-start="weekStart"
        :title="title"
        @confirm="confirm"
        @cancel="cancel"
      >
        <template slot="button-cancel__internal" slot-scope="scope">
          <slot name="button-cancel" :step="scope.step">Cancel</slot>
        </template>
        <template slot="button-confirm__internal" slot-scope="scope">
          <slot name="button-confirm" :step="scope.step">Ok</slot>
        </template>
      </datetime-popup>
    </transition-group>
  </div>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import { DateTime, DateTimeFormatOptions } from "luxon";
import { DatetimePopup } from "vue-datetime";
import "vue-datetime/dist/vue-datetime.css";

@Component({ components: { DatetimePopup } })
export default class DateTimePicker extends Vue {
  @Prop({ type: String }) readonly value!: string;
  @Prop({ type: String, default: null }) readonly inputId!: string;
  @Prop({ type: Array, default: () => [] })
  readonly inputClass!: string[];
  @Prop({ type: Boolean, default: false }) readonly relative!: boolean;
  @Prop({ type: [Object, String, Function], default: null }) readonly format!:
    | DateTimeFormatOptions
    | string
    | ((value: Date) => string);
  @Prop({ type: String, default: "date" }) readonly type!: string;
  @Prop({ type: Number, default: 1 }) readonly hourStep!: number;
  @Prop({ type: Number, default: 1 }) readonly minuteStep!: number;
  @Prop({ type: String, default: null }) readonly minDatetime!: string;
  @Prop({ type: String, default: null }) readonly maxDatetime!: string;
  @Prop({ type: Boolean, default: false }) readonly auto!: boolean;
  @Prop({ type: Number, default: 1 }) readonly weekStart!: number;
  @Prop({ type: String }) readonly title!: string;

  isOpen!: boolean;
  datetime!: DateTime;

  created() {
    this.emitInput();
  }

  data() {
    return {
      isOpen: false,
      datetime: DateTime.fromISO(this.value).toUTC()
    };
  }

  get inputValue() {
    let format = this.format;
    if (!format) {
      switch (this.type) {
        case "date":
          format = DateTime.DATE_MED;
          break;
        case "time":
          format = DateTime.TIME_24_SIMPLE;
          break;
        case "datetime":
        case "default":
          format = DateTime.DATETIME_MED;
          break;
      }
    }
    console.debug(typeof format);

    if (typeof format === "string") {
      return (
        (this.datetime &&
          DateTime.fromISO(this.datetime.toISO())
            .setZone("local")
            .toFormat(format)) ||
        ""
      );
    } else if (typeof format === "function") {
      return (this.format as Function)(this.datetime) || "";
    } else {
      return (
        (this.datetime &&
          this.datetime.setZone("local").toLocaleString(format as any)) ||
        ""
      );
    }
  }

  get popupDate() {
    return this.datetime
      ? this.datetime.setZone("local")
      : this.newPopupDatetime();
  }

  get popupMinDatetime() {
    return this.minDatetime
      ? DateTime.fromISO(this.minDatetime).setZone("local")
      : null;
  }

  get popupMaxDatetime() {
    return this.maxDatetime
      ? DateTime.fromISO(this.maxDatetime).setZone("local")
      : null;
  }

  @Watch("value")
  onNewValue(newValue: any) {
    this.datetime = DateTime.fromISO(newValue).toUTC();
  }

  emitInput() {
    let datetime = this.datetime ? this.datetime.setZone("UTC") : null;
    if (datetime && this.type === "date") {
      datetime = datetime.startOf("day");
    }
    this.$emit("input", datetime ? datetime.toISO() : "");
  }

  open(event: any) {
    event.target.blur();
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    this.$emit("close");
  }

  confirm(datetime: any) {
    this.datetime = datetime.toUTC();
    this.emitInput();
    this.close();
  }

  cancel() {
    this.close();
  }

  newPopupDatetime() {
    let datetime = DateTime.utc()
      .setZone("local")
      .set({ seconds: 0, milliseconds: 0 } as any);
    if (this.popupMinDatetime && datetime < this.popupMinDatetime) {
      datetime = this.popupMinDatetime.set({
        seconds: 0,
        milliseconds: 0
      } as any);
    }
    if (this.popupMaxDatetime && datetime > this.popupMaxDatetime) {
      datetime = this.popupMaxDatetime.set({
        seconds: 0,
        milliseconds: 0
      } as any);
    }
    if (this.minuteStep === 1) {
      return datetime;
    }
    const roundedMinute =
      Math.round(datetime.minute / this.minuteStep) * this.minuteStep;
    if (roundedMinute === 60) {
      return datetime.plus({ hours: 1 }).set({ minute: 0 });
    }
    return datetime.set({ minute: roundedMinute });
  }

  setValue(event: any) {
    this.datetime = DateTime.fromISO(event.target.value).toUTC();
    this.emitInput();
  }
}
</script>

<style>
.vdatetime-fade-enter-active,
.vdatetime-fade-leave-active {
  transition: opacity 0.4s;
}
.vdatetime-fade-enter,
.vdatetime-fade-leave-to {
  opacity: 0;
}
.vdatetime-overlay {
  z-index: 999;
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.5);
  transition: opacity 0.5s;
}
.vdatetime-time-picker__item:hover,
.vdatetime-month-picker__item:hover,
.vdatetime-year-picker__item:hover {
  font-size: 20px !important;
}
.vdatetime-time-picker__item--selected:hover,
.vdatetime-month-picker__item--selected:hover,
.vdatetime-year-picker__item--selected:hover {
  font-size: 32px !important;
}
.vdatetime-time-picker__item--selected {
  background: #ebebff;
}
.vdatetime-input {
  cursor: pointer;
}
</style>
