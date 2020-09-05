<template>
  <v-container class="pl-0" fluid>
    <v-row justify="space-around">
      <v-col cols="12" class="pa-0 ma-0">
        <apex
          v-if="chartData"
          id="timechart"
          ref="timechart"
          class="chart pa-0 ma-0"
          height="400px"
          :options="timeoptions"
          :series="timeseries"
        ></apex>
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="12" class="pa-0 ma-0 mt-n9">
        <apex
          v-if="chartData"
          id="eventchart"
          ref="eventchart"
          class="chart pa-0 ma-0"
          height="160px"
          :options="eventoptions"
          :series="eventseries"
        ></apex>
      </v-col>
    </v-row>
    <v-row
      v-if="$apollo.queries.chartData.loading"
      class="pl-8"
      justify="space-around"
    >
      <v-col cols="10">
        <v-progress-linear indeterminate color="primary"></v-progress-linear>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import ApexCharts from "apexcharts";
import VueApexCharts from "vue-apexcharts";
import { gql } from "apollo-boost";
import {
  log,
  LogLevel,
  numericStartTime,
  numericStopTime,
  secondsToString
} from "@shared/utils";
import {
  GQLVehicle,
  GQLChartData,
  GQLEventType,
  GQLEventList,
  GQLChargeType,
  GQLChargePlan
} from "@shared/sc-schema";
import { DateTime } from "luxon";

function pricePrecision(input: number): number {
  return Math.round(input * 10) / 10;
}
function levelPrecision(input: number): number {
  return Math.round(input);
}
function scalePrice(input: number): number {
  return Math.round(input * 1e3) / 10;
}
function timeOnly(input: Date): string {
  return DateTime.fromJSDate(input).toFormat("HH:mm");
}

const Color = {
  red: "#ff0000aa",
  labelBackground: "#ffffff66",
  price: "#4fa74a",
  priceText: "#2f872a",
  level: "#008ffb",
  levelLimits: "#008ffbaa",
  predicted: "#33B2DF",
  plan: "#2e93faff",
  planPrefered: "#2e93fabb",
  planText: "#305f8f",
  charge: "#30bb6f",
  trip: "#ff4560",
  sleep: "#886dd0",
  threshold: "#2f872a",
  thresholdText: "#2f872a"
};

@Component({
  components: { apex: VueApexCharts },
  apollo: {
    chartData: {
      query: gql`
        query ChartData(
          $vehicleID: String!
          $from: DateTime!
          $period: Int
          $locationID: String
        ) {
          chartData(
            vehicleID: $vehicleID
            from: $from
            period: $period
            locationID: $locationID
          ) {
            vehicleID
            batteryLevel
            chargeCurve
            directLevel
            maximumLevel
            locationID
            thresholdPrice
            prices {
              startAt
              price
            }
            chargePlan {
              chargeType
              chargeStart
              chargeStop
              level
              comment
            }
            stateMap {
              start
              period
              minimumLevel
              maximumLevel
              drivenSeconds
              drivenMeters
              chargedSeconds
              chargedEnergy
              chargeCost
              chargeCostSaved
            }
            eventList {
              eventType
              start
              end
              data
            }
          }
        }
      `,
      variables() {
        return {
          vehicleID: this.vehicle && this.vehicle.id,
          from: this.defaultMinX,
          // to: this.defaultMaxX,
          period: 60,
          locationID: this.location_id || null
        };
      },
      deep: true,
      pollInterval: 30e3,
      result() {
        this.$data.fullUpdate = true;
        log(LogLevel.Debug, "new chartDataResult");
      },
      fetchPolicy: "network-only"
    }
  }
})
export default class eventchart extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: GQLVehicle;
  @Prop({ type: String }) readonly location_id!: string | undefined;
  chartData?: GQLChartData;
  chartReady: boolean = false;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  minLevel?: number | undefined;
  maxLevel?: number | undefined;
  fullUpdate!: boolean;

  data() {
    return {
      chartData: undefined,
      fullUpdate: false
    };
  }
  mounted() {}

  timer?: any;
  created() {
    this.timer = setInterval(() => {
      if (this.fullUpdate) {
        console.log("timerInterval, full update");
        // TODO DO WE NEED IT?
        /*{
          const timechart = (this.$refs.timechart as any) as ApexCharts;
          const s = this.timeseries;
          //console.debug(s);
          timechart && timechart.updateOptions(this.timeoptions);
          timechart && timechart.updateSeries(s);
        }
        {
          const eventchart = (this.$refs.eventchart as any) as ApexCharts;
          const s = this.eventseries;
          eventchart && eventchart.updateOptions(this.eventoptions);
          eventchart && eventchart.updateSeries(s);
        }*/
        const timechart = (this.$refs.timechart as any) as ApexCharts;
        timechart && timechart.updateOptions(this.timeoptions);
        const eventchart = (this.$refs.eventchart as any) as ApexCharts;
        eventchart && eventchart.updateOptions(this.eventoptions);
        this.fullUpdate = false;
      }
      this.annotate(); // Move the timeline
    }, 30e3);
  }
  beforeDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  @Watch("vehicle", { deep: true })
  onVehicleUpdate() {
    // TODO, looks like we need debouncing here or was it just a glitch?
    log(LogLevel.Trace, `onVehicleUpdate triggered`);
    this.$apollo.queries.chartData.refresh();
  }

  @Watch("chartData")
  onChartDataChange() {
    log(LogLevel.Trace, `onChartDataChange triggered`);
    this.fullUpdate = true;
  }

  private chargeDuration(curve: any, from: number, to: number) {
    let sum = 0;
    for (let level = from; level <= to; ++level) {
      sum += curve[Math.min(100, Math.ceil(level))] * (level < to ? 1.0 : 0.75); // remove 25% of the last % to not overshoot
    }
    return sum * 1e3;
  }
  private chargeAmount(curve: any, from: number, time: number): number {
    let timeLeft = time;
    let level = from;
    while (timeLeft > 0) {
      const needed = curve[Math.min(100, Math.ceil(level))];
      level += Math.min(1, timeLeft / needed);
      timeLeft -= needed;
    }
    return level;
  }

  chartAnnotations: any[] = [];
  annotate() {
    const showPrices = Boolean(this.chartData && this.chartData.prices);
    log(LogLevel.Trace, `annotate(${showPrices})`);

    if (!(this.chartReady && this.chartData)) return;

    const timechart = (this.$refs.timechart as any) as ApexCharts;
    if (!timechart) return;

    const thisHour = DateTime.local()
      .startOf("hour")
      .toMillis();

    timechart.clearAnnotations();

    // Annotate level axis
    if (showPrices && this.minLevel !== undefined) {
      const min = levelPrecision(this.minLevel); //Math.floor(this.minLevel / 10) * 10;
      if (min > 0) {
        timechart.addYaxisAnnotation({
          y: min,
          yAxisIndex: 0,
          strokeDashArray: [2, 2],
          fillColor: "none",
          borderColor: Color.levelLimits,
          borderWidth: 1,
          opacity: 0,
          offsetX: 0,
          offsetY: 0,
          label: {
            borderWidth: 0,
            text: `${min}%`,
            textAnchor: "start",
            position: "left",
            offsetX: 4,
            offsetY: 8,
            style: {
              background: "#ffffffcc",
              color: Color.level,
              fontSize: "12px",
              cssClass: "apexcharts-xaxis-annotation-label"
            }
          }
        });
      }
    }
    if (showPrices && this.maxLevel !== undefined) {
      const max = levelPrecision(this.maxLevel); //Math.ceil(this.maxLevel / 10) * 10;
      if (max < 100) {
        timechart.addYaxisAnnotation({
          y: max,
          yAxisIndex: 0,
          strokeDashArray: [2, 2],
          fillColor: "none",
          borderColor: Color.levelLimits,
          borderWidth: 1,
          opacity: 0,
          offsetX: 0,
          offsetY: 0,
          label: {
            borderWidth: 0,
            text: `${max}%`,
            textAnchor: "start",
            position: "left",
            offsetX: 4,
            offsetY: 8,
            style: {
              background: "#ffffffcc",
              color: Color.level,
              fontSize: "12px",
              cssClass: "apexcharts-xaxis-annotation-label"
            }
          }
        });
      }
    }

    // Add plan annotations
    for (const a of this.chartAnnotations as {
      from: number;
      to: number;
      plan: GQLChargePlan;
    }[]) {
      const from = Math.max(a.from, this.chartStart);
      const to = Math.min(a.to, this.chartStop);
      if (to > from) {
        timechart.addXaxisAnnotation({
          x: from,
          x2: to,
          strokeDashArray: 0,
          fillColor:
            a.plan.chargeType === GQLChargeType.Fill ||
            a.plan.chargeType === GQLChargeType.Prefered
              ? Color.planPrefered
              : Color.plan,
          borderColor: "none",
          borderWidth: 0,
          opacity: 0.2,
          offsetX: 0,
          offsetY: 0,
          label: {
            borderWidth: 0,
            offsetX: 3,
            offsetY: -8,
            text: a.plan.comment,
            style: {
              background: Color.labelBackground,
              color: Color.planText
            }
          }
        });
      }
    }

    if (
      showPrices &&
      this.minPrice !== undefined &&
      this.maxPrice !== undefined
    ) {
      const thisPrice =
        this.chartData.prices &&
        this.chartData.prices.find(
          f => new Date(f.startAt).getTime() === thisHour
        );

      // Annotate current price
      if (thisPrice) {
        timechart.addPointAnnotation({
          x: Date.now(),
          y: scalePrice(thisPrice.price),
          yAxisIndex: 2,
          seriesIndex: 2,
          marker: {
            size: 3,
            fillColor: "none",
            strokeColor: Color.red,
            strokeWidth: 1,
            shape: "circle",
            OffsetX: 0,
            OffsetY: 0,
            cssClass: ""
          },
          label: {
            borderWidth: 1,
            text: scalePrice(thisPrice.price).toString(),
            textAnchor: "middle",
            offsetX: 0,
            offsetY: 0,
            style: {
              background: "white",
              color: Color.red,
              fontSize: "12px",
              cssClass: "apexcharts-point-annotation-label",
              padding: {
                left: 5,
                right: 5,
                top: 1,
                bottom: 1
              }
            }
          }
        });
      }

      // Annotate threshold price
      if (this.chartData.thresholdPrice) {
        const t = scalePrice(this.chartData.thresholdPrice);
        if (t >= this.minPriceX && t <= this.maxPriceX) {
          timechart.addYaxisAnnotation({
            y: t,
            yAxisIndex: 2,
            strokeDashArray: [4, 6],
            fillColor: "none",
            borderColor: Color.threshold,
            borderWidth: 1,
            opacity: 0.2,
            offsetX: 0,
            offsetY: 0,
            label: {
              borderWidth: 0,
              text: t.toString(),
              textAnchor: "end",
              position: "right",
              offsetX: 0,
              offsetY: 0,
              style: {
                background: "none",
                color: Color.thresholdText,
                fontSize: "12px",
                cssClass: "apexcharts-xaxis-annotation-label"
              }
            }
          });
        }
      }
    }

    // Annotate current time
    timechart.addXaxisAnnotation({
      x: Date.now(),
      strokeDashArray: 0,
      borderColor: Color.red,
      opacity: 0.1,
      offsetX: 0,
      offsetY: 0,
      label: {
        borderWidth: 0,
        text: timeOnly(new Date()),
        textAnchor: "middle",
        position: "bottom",
        orientation: "horizontal",
        offsetX: 0,
        offsetY: 14,
        style: {
          background: "none",
          color: Color.red,
          fontSize: "12px",
          cssClass: "apexcharts-xaxis-annotation-label"
        }
      }
    });
  }

  get defaultMaxX(): number {
    return DateTime.local()
      .plus({ hours: 37 })
      .startOf("hour")
      .toMillis();
  }

  get defaultMinX(): number {
    return DateTime.local()
      .minus({ hours: 24 })
      .startOf("hour")
      .toMillis();
  }

  get minPriceX(): number {
    if (this.minPrice !== undefined && this.maxPrice !== undefined) {
      return Math.max(
        this.minPrice >= 0 ? 0 : -Infinity,
        this.minPrice - (this.maxPrice - this.minPrice) * 0.05
      );
    }
    return 0;
  }
  get maxPriceX(): number {
    if (this.minPrice !== undefined && this.maxPrice !== undefined) {
      return Math.ceil(this.maxPrice + (this.maxPrice - this.minPrice) * 0.05);
    }
    return 0;
  }

  chartStart: number = this.defaultMinX;
  chartStop: number = this.defaultMaxX;
  discreteMarkers: any = [];
  get timeseries() {
    const showPrices = Boolean(this.chartData && this.chartData.prices);
    log(LogLevel.Trace, `timeseries(${showPrices})`);

    const now = Date.now();

    this.chartStart = this.defaultMinX;
    this.chartStop = DateTime.local()
      .plus({ hours: 6 })
      .startOf("hour")
      .toMillis();

    const series: any = [];

    if (!this.chartData) return series;

    /***
     *  Fill price data
     ***/
    let priceData: any = [];
    if (showPrices) {
      priceData = this.chartData.prices!.map(p => {
        const price = scalePrice(p.price);
        return [new Date(p.startAt).getTime(), price];
      });
      // extend 1 hour to get a step line in the end
      const last = this.chartData.prices![this.chartData.prices!.length - 1];
      priceData.push([
        new Date(last.startAt).getTime() + 60 * 60e3,
        scalePrice(last.price)
      ]);
    }

    /***
     *  Fill past battery level
     ***/
    let levelData: any = [];
    let eventList = (this.chartData.eventList || []).map(e => ({
      eventType: e.eventType,
      start_ts: numericStartTime(e.start),
      end_ts: numericStopTime(e.end),
      start_level: e.data.startLevel,
      end_level: e.data.endLevel
    }));

    if (this.chartData.stateMap && this.chartData.stateMap.length > 1) {
      const margin = 15 * 60e3;
      levelData = this.chartData.stateMap
        .map(p => {
          let level: number | null = Math.floor(
            (p.minimumLevel + p.maximumLevel) / 2
          );
          const ts = numericStartTime(p.start);
          const te = ts + 60 * 60e3;
          for (const e of eventList) {
            if (te < e.start_ts || ts > e.end_ts + margin) continue; // not even close to this event
            if (ts >= e.start_ts && te <= e.end_ts) {
              // Inside event
              level =
                e.eventType === GQLEventType.Sleep
                  ? null // no data during sleep
                  : e.eventType === GQLEventType.Charge
                  ? p.minimumLevel // during charge, the start of the time block is where level is least
                  : p.maximumLevel; // during trips, the start of the time block is where level is most
            } else {
              level = null;
            }
          }
          return [ts, level];
        })
        .filter(f => f[1] !== null);
      levelData.push([now, this.vehicle.batteryLevel]);
    }
    for (const e of eventList) {
      if (e.start_level !== undefined) {
        levelData.push([e.start_ts, e.start_level]);
      }
      if (e.end_level !== undefined) {
        levelData.push([e.end_ts, e.end_level]);
      }
    }

    /***
     *  Fill future battery level
     ***/
    let predictData: any = [];
    this.chartAnnotations = [];
    this.discreteMarkers = [];
    {
      let level = this.vehicle.batteryLevel;
      predictData.push([now, level]);
      if (this.chartData.chargePlan) {
        // Simulate charging
        for (const c of this.chartData.chargePlan) {
          if (c.chargeType === GQLChargeType.Calibrate) continue; // TODO remove

          // Calculate charge bounds
          const timeNeeded = this.chargeDuration(
            this.chartData.chargeCurve,
            level,
            c.level
          );
          const cs = Math.max(
            now,
            c.chargeStart ? new Date(c.chargeStart).getTime() : -Infinity
          );
          let ce = cs + timeNeeded;
          if (
            c.chargeStop &&
            ce - new Date(c.chargeStop).getTime() >
              this.chartData.chargeCurve[c.level] * 1e3
          ) {
            ce = new Date(c.chargeStop).getTime();
          }
          if (ce < cs) continue;

          // Fill up level
          if (cs > predictData[predictData.length - 1][0]) {
            predictData.push([cs, Math.floor(level)]);
          }
          level = Math.max(
            level,
            Math.min(
              c.level,
              this.chargeAmount(
                this.chartData.chargeCurve,
                level,
                (ce - cs) / 1e3
              )
            )
          );
          predictData.push([ce, Math.floor(level)]);
          // Add chart annotations
          this.chartAnnotations.push({
            from: cs,
            to: ce,
            plan: c
          });
        }
      }
    }

    /***
     *  Adjust the time bounds
     ***/
    this.chartStop =
      priceData.length > 0
        ? priceData[priceData.length - 1][0]
        : DateTime.fromMillis(
            Math.max(
              now,
              predictData.length ? predictData[predictData.length - 1][0] : 0
            )
          )
            .plus({ hours: 4 })
            .startOf("hour")
            .toMillis();

    /***
     *  Interpolate all curves
     ***/
    priceData = priceData.sort((a: any, b: any) => a[0] - b[0]);
    levelData = levelData.sort((a: any, b: any) => a[0] - b[0]);
    predictData = predictData.sort((a: any, b: any) => a[0] - b[0]);
    const timeLine = [
      [this.chartStart],
      ...priceData,
      ...levelData,
      ...predictData,
      [this.chartStop]
    ]
      .reduce((acc: number[], cur) => {
        if (acc.indexOf(cur[0]) < 0) {
          acc.push(cur[0]);
        }
        return acc;
      }, [])
      .sort((a, b) => a - b);

    const interpolate = (data: any[], i: number, ts: number): number | null => {
      let v = i > 0 ? data[i - 1][1] : null;
      if (v === null) return v;
      const w = (ts - data[i - 1][0]) / (data[i][0] - data[i - 1][0]);
      return v * (1 - w) + data[i][1] * w;
    };
    for (let i = 0; i < timeLine.length; ++i) {
      const ts = timeLine[i];
      if (showPrices) {
        if (i >= priceData.length) {
          priceData.push([ts, null]);
        } else if (priceData[i][0] > ts) {
          priceData.splice(i, 0, [ts, i > 0 ? priceData[i - 1][1] : null]);
        }
      }

      if (i >= levelData.length) {
        levelData.push([ts, null]);
      } else if (levelData[i][0] > ts) {
        levelData.splice(i, 0, [
          ts,
          interpolate(levelData, i, ts) || levelData[i][1]
        ]);
      }

      if (i >= predictData.length) {
        predictData.push([ts, i > 0 ? predictData[i - 1][1] : null]);
      } else if (predictData[i][0] > ts) {
        predictData.splice(i, 0, [ts, interpolate(predictData, i, ts) || null]);
      } else if (ts > now && ts < this.chartStop) {
        this.discreteMarkers.push({
          seriesIndex: 1,
          dataPointIndex: i,
          size: 4,
          fillColor: Color.predicted,
          strokeColor: "white"
        });
      }
    }

    /***
     *  Trim data to fit time bounds
     ***/
    const seriesTrim = (data: any[]) => {
      let offset = 0;
      while (data.length > 0 && data[0][0] < this.chartStart) {
        data.shift();
        offset--;
      }
      while (data.length > 0 && data[data.length - 1][0] > this.chartStop) {
        data.pop();
      }
      return offset;
    };
    seriesTrim(priceData);
    seriesTrim(levelData);
    const offset = seriesTrim(predictData);

    // realign discrete markers in prediction curve
    if (offset != 0) {
      for (let i = 0; i < this.discreteMarkers.length; ++i) {
        this.discreteMarkers[i].dataPointIndex += offset;
      }
    }

    /***
     *  Find max axis values
     ***/
    this.minPrice = undefined;
    this.maxPrice = undefined;
    this.minLevel = undefined;
    this.maxLevel = undefined;
    for (const v of priceData) {
      this.minPrice = Math.min(this.minPrice || Infinity, v[1] || Infinity);
      this.maxPrice = Math.max(this.maxPrice || -Infinity, v[1] || -Infinity);
    }
    for (const v of [...levelData, ...predictData]) {
      this.minLevel = Math.min(this.minLevel || Infinity, v[1] || Infinity);
      this.maxLevel = Math.max(this.maxLevel || -Infinity, v[1] || -Infinity);
    }

    series.push({ name: "level", type: "area", data: levelData });
    series.push({ name: "predicted", type: "area", data: predictData });
    if (showPrices) {
      series.push({ name: "price", type: "area", data: priceData });
    }
    return series;
  }

  get timeoptions() {
    const showPrices = Boolean(this.chartData && this.chartData.prices);
    log(LogLevel.Trace, `timeoptions(${showPrices})`);

    const yaxisPrice = {
      show: showPrices,
      opposite: false,
      axisBorder: {
        show: true,
        color: Color.price,
        offsetX: -1
      },
      decimalsInFloat: 1,
      labels: {
        minWidth: 55,
        maxWidth: 55,
        style: {
          colors: Color.priceText
        }
      },
      tickAmount: 5,
      min: (min: number) => this.minPriceX || Math.floor(min),
      max: (max: number) => this.maxPriceX || Math.ceil(max)
    };
    const yaxisLevelHidden = {
      show: false,
      min: 0,
      max: 100
    };
    const yaxisLevel = {
      show: true,
      min: 0,
      max: 100,
      axisBorder: {
        show: true,
        color: Color.level,
        offsetX: -1
      },
      decimalsInFloat: 0,
      labels: {
        minWidth: 55,
        maxWidth: 55,

        style: { fontWeight: 600, colors: Color.level },
        formatter: function(val: number, _index: number) {
          return `${levelPrecision(val)}%`;
        }
      }
    };

    return {
      chart: {
        id: "time-chart",
        type: "line",
        animations: { enabled: false },
        background: "none",
        toolbar: {
          show: false
        },
        selection: { enabled: false },
        zoom: { enabled: false },
        events: {
          updated: (_chartContext: any, _config: any) => {
            if (this.chartData) {
              this.chartReady = true;
              this.annotate();
            }
          }
        }
      },
      title: {
        text: ""
      },
      xaxis: {
        type: "datetime",
        min: this.chartStart,
        max: this.chartStop,
        tickAmount: Math.round((this.chartStop - this.chartStart) / 3600e3),
        labels: {
          rotate: 0,

          datetimeUTC: true,
          formatter: (_value: any, timestamp: any, _index: any) => {
            const chart: any = this.$refs.timechart;
            if (chart) {
              let skip = 1;
              const w = chart && chart.$el && chart.$el.clientWidth;
              if (w) {
                const ticks = Math.round(
                  (this.chartStop - this.chartStart) / 3600e3
                );
                for (let space = w / ticks; space < 50; ) {
                  skip++;
                  space = w / Math.floor(ticks / skip);
                }
              }
              const hour = new Date(timestamp).getHours();
              if (hour === 0) {
                return DateTime.fromMillis(timestamp).toFormat("dd MMM");
              }
              if (hour % skip > 0) {
                return "";
              }
            }
            return DateTime.fromMillis(timestamp).toFormat("HH:mm");
          }
        },
        tooltip: {
          enabled: true,
          formatter: (value: number) => {
            return timeOnly(new Date(value));
          }
        },
        crosshairs: {
          show: true
        }
      },
      yaxis: showPrices
        ? [yaxisLevelHidden, yaxisLevelHidden, yaxisPrice]
        : [yaxisLevel, yaxisLevelHidden],
      stroke: {
        show: true,
        lineCap: "butt",
        curve: ["straight", "straight", "stepline"],
        width: [2, 2.5, 2],
        dashArray: [0, [4, 2], 0]
      },
      colors: [Color.level, Color.predicted, Color.price],
      fill: {
        opacity: [1, 1, 0.6],
        type: ["gradient", "gradient", "gradient"],
        gradient: {
          shade: "light",
          enabled: true,
          type: "vertical",
          opacityFrom: [0.15, 0.15, 0.45],
          opacityTo: [0.05, 0.05, 0.25]
        }
      },
      annotations: {
        position: "front",
        yaxis: [],
        xaxis: [],
        points: []
      },
      legend: {
        show: false,

        horizontalAlign: "left",
        offsetX: 40
      },
      markers: {
        size: [0.1, 0.1, 0.1],
        colors: ["transparent", "transparent", "transparent"],
        strokeColors: ["transparent", "transparent", "transparent"],
        strokeWidth: [0, 2, 0],
        strokeOpacity: [0, 0.9, 0],
        fillOpacity: [0, 1, 0],
        shape: "circle",
        radius: 2,
        discrete: this.discreteMarkers
      },
      hover: {
        sizeOffset: 3
      },
      tooltip: {
        enabled: true,
        shared: true,
        intersect: false,
        followCursor: false,
        theme: "light",
        style: {
          fontSize: "12px",
          fontFamily: undefined
        },
        marker: {
          show: true
        },
        x: {
          show: false
        },
        y: {
          formatter: (
            value: any,
            { series, seriesIndex, dataPointIndex }: any
          ) => {
            if (value === null) return null;
            if (
              seriesIndex === 1 &&
              dataPointIndex > 0 &&
              series[0][dataPointIndex]
            ) {
              // remove predicted tooltip on current time (if series 0 has data at this point)
              return null;
            }
            if (seriesIndex === 0) {
              return `${levelPrecision(value)}%`;
            } else if (seriesIndex === 1) {
              return `&thickapprox; ${levelPrecision(value)}%`;
            } else if (
              seriesIndex === 2 &&
              dataPointIndex < series[0].length - 1
            ) {
              return `${pricePrecision(value)} öre`;
            } else {
              return null;
            }
          }
        }
      },
      grid: {
        show: true,
        borderColor: "#90a4ae66",
        strokeDashArray: [1, 1]
      }
    };
  }

  eventLookup: GQLEventList[][] = [[], [], []];
  get eventseries() {
    const sleepData: any = [];
    const tripData: any = [];
    const chargeData: any = [];

    this.eventLookup = [[], [], []];
    if (this.chartData && this.chartData.eventList) {
      this.chartData.eventList.forEach(e => {
        const start = Math.max(this.chartStart, numericStartTime(e.start));
        const end = Math.min(this.chartStop, numericStopTime(e.end));
        switch (e.eventType) {
          case GQLEventType.Trip:
            this.eventLookup[0].push(e);
            tripData.push({ x: "event", y: [start, end], data: e.data });
            break;
          case GQLEventType.Charge:
            this.eventLookup[1].push(e);
            chargeData.push({ x: "event", y: [start, end], data: e.data });
            break;
          case GQLEventType.Sleep:
            this.eventLookup[2].push(e);
            sleepData.push({
              x: "event",
              y: [start, e.data.active ? Date.now() : end],
              data: e.data
            });
            break;
        }
      });
    }
    return [
      {
        name: "Trip",
        data: [...tripData, { x: "event", y: [null, null] }]
      },
      {
        name: "Charge",
        data: [...chargeData, { x: "event", y: [null, null] }]
      },
      {
        name: "Sleep",
        data: [...sleepData, { x: "event", y: [null, null] }]
      }
    ];
  }

  get eventoptions() {
    log(LogLevel.Trace, `eventoptions()`);
    return {
      chart: {
        id: "event-chart",
        animations: { enabled: false },
        background: "transparent",
        type: "rangeBar",
        toolbar: {
          show: false
        },
        selection: { enabled: false },
        zoom: { enabled: false }
      },
      title: {
        text: ""
      },
      plotOptions: {
        bar: {
          horizontal: true,
          rangeBarOverlap: true
        }
      },
      stroke: {
        show: true,
        curve: "smooth",
        lineCap: "butt",
        width: 1
      },
      colors: [Color.trip, Color.charge, Color.sleep],
      xaxis: {
        position: "top",
        type: "datetime",
        min: this.chartStart,
        max: this.chartStop,
        tickAmount: Math.round((this.chartStop - this.chartStart) / 3600e3),
        labels: { datetimeUTC: true, format: "" },
        tooltip: {
          enabled: false
        }
      },
      yaxis: {
        show: false,
        min: this.chartStart,
        max: this.chartStop,
        labels: {
          minWidth: 55,
          maxWidth: 55
        }
      },
      tooltip: {
        enabled: true,
        intersect: false,
        shared: false,
        followCursor: false,
        custom: undefined,
        theme: "light",
        style: {
          fontSize: "12px",
          fontFamily: undefined
        },
        marker: {
          show: true
        },
        fixed: {
          enabled: true,
          position: "bottomLeft",
          offsetX: 60,
          offsetY: 0
        },
        x: {
          show: false
        },
        y: {
          show: true,
          formatter: (
            value: any,
            { _series, seriesIndex, dataPointIndex }: any
          ) => {
            if (
              this.eventLookup &&
              this.eventLookup[seriesIndex] &&
              this.eventLookup[seriesIndex][dataPointIndex]
            ) {
              const e = this.eventLookup[seriesIndex][dataPointIndex];
              const d =
                (numericStopTime(e.end) - numericStartTime(e.start)) / 1e3;
              const duration = secondsToString(d, 2, false);
              switch (e.eventType) {
                case GQLEventType.Sleep:
                  return duration;
                case GQLEventType.Charge: {
                  const used = Math.round(e.data.energyUsed * 10) / 10;
                  return `${duration} (${e.data.charger}${
                    used ? " " + used + "kWh" : ""
                  })`;
                }
                case GQLEventType.Trip:
                  return `${duration} (${Math.round(e.data.distance / 1e2) /
                    10}km)`;
              }
            }
            return null;
          }
        }
      },
      legend: {
        show: true,
        position: "bottom",
        horizontalAlign: "right",
        offsetX: 0,
        offsetY: -20
      }
    };
  }
}
</script>

<style></style>
