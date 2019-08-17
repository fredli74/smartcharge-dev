<template>
  <v-container fluid>
    <v-layout v-resize="onResize" row justify-space-around>
      <v-flex xs12 xl6>
        <apex
          v-if="chartData && chartData.prices.length > 1"
          id="pricechart"
          ref="pricechart"
          class="chart"
          height="400px"
          :options="priceoptions"
          :series="priceseries"
        ></apex
      ></v-flex>
      <v-flex xs12 xl6>
        <apex
          v-if="
            chartData &&
              chartData.prices.length > 1 &&
              chartData.levelChargeTime
          "
          id="chargechart"
          ref="chargechart"
          class="chart"
          :height="chargeHeight"
          :options="chargeoptions"
          :series="chargeseries"
        ></apex
      ></v-flex>
      <p v-if="chartData && !(chartData.prices.length > 1)">
        No price data
      </p>
    </v-layout>
  </v-container>
</template>

<script lang="ts">
// import { strict as assert } from "assert";
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import VueApexCharts from "vue-apexcharts";
import { gql } from "apollo-boost";
import deepmerge from "deepmerge";
import { log, LogLevel } from "@shared/utils";
import { ChartData, Location } from "@server/gql/location-type";
import { Vehicle, ChargeType } from "@server/gql/vehicle-type";

interface chartDataResult {
  chartData: ChartData;
}
function scalePrice(input: number): number {
  return Math.round(input / 1e2) / 10;
}
function timeOnly(input: Date): string {
  return `${("0" + input.getHours()).substr(-2)}:${(
    "0" + input.getMinutes()
  ).substr(-2)}`;
}

const defaultOptions = {
  chart: {
    type: "line",
    animations: { enabled: false },
    background: "none",
    toolbar: {
      show: false
    },
    selection: { enabled: false },
    zoom: { enabled: false }
  },
  title: {
    text: ""
  },
  annotations: {
    position: "front",
    yaxis: [],
    xaxis: [],
    points: []
  },

  stroke: {
    show: true,
    lineCap: "butt",
    colors: undefined,
    width: 2,
    dashArray: 0
  },
  xaxis: {
    type: "datetime",
    tooltip: {
      enabled: true,
      formatter: (value: number) => {
        return timeOnly(new Date(value));
      },
      offsetY: 0,
      style: {
        fontSize: undefined,
        fontFamily: undefined
      }
    }
  },
  legend: {
    show: false
  },
  markers: {
    size: 0,
    colors: undefined,
    strokeColors: "#fff",
    strokeWidth: 2,
    strokeOpacity: 0.9,
    fillOpacity: 1,
    discrete: [],
    shape: "circle",
    radius: 2,
    offsetX: 0,
    offsetY: 0,
    onClick: undefined,
    onDblClick: undefined,
    hover: {
      size: undefined,
      sizeOffset: 3
    }
  },
  tooltip: {
    enabled: true,
    shared: true,
    followCursor: false,
    custom: undefined,
    theme: "light",
    style: {
      fontSize: "12px",
      fontFamily: undefined
    },
    onDatasetHover: {
      highlightDataSeries: false
    },
    x: {
      show: false
    },
    marker: {
      show: true
    }
  }
};

@Component({
  components: { apex: VueApexCharts },
  apollo: {
    chartData: {
      query: gql`
        query ChartData($vehicleID: String!, $locationID: String!) {
          chartData(locationID: $locationID, vehicleID: $vehicleID) {
            locationID
            locationName
            vehicleID
            batteryLevel
            minimumLevel
            levelChargeTime
            thresholdPrice
            prices {
              startAt
              price
            }
            chargePlan {
              chargeStart
              chargeStop
              level
              chargeType
              comment
            }
          }
        }
      `,
      variables() {
        return {
          vehicleID: this.vehicle && this.vehicle.id,
          locationID: this.location && this.location.id
        };
      },
      deep: true,
      pollInterval: 60e3,
      result() {
        this.$data.fullUpdate = true;
        log(LogLevel.Debug, "new chartDataResult");
      },
      fetchPolicy: "network-only"
    }
  }
})
export default class ChargeChart extends Vue {
  @Prop({ type: Object, required: true }) readonly vehicle!: Vehicle;
  @Prop({ type: Object, required: true }) readonly location!: Location;
  chartData?: ChartData;
  chartReady: boolean = false;
  minPrice!: number;
  maxPrice!: number;
  minLevel!: number;
  maxLevel!: number;
  fullUpdate!: boolean;
  chargeHeight!: string;

  data() {
    return {
      chartData: undefined,
      minPrice: 0,
      maxPrice: 1,
      minLevel: 0,
      maxLevel: 100,
      fullUpdate: false,
      chargeHeight: "250px"
    };
  }
  mounted() {}
  onResize() {
    this.chargeHeight = window.innerWidth > 1904 ? "400px" : "250px";
  }

  timer?: any;
  created() {
    this.timer = setInterval(() => {
      if (this.fullUpdate) {
        const pricechart = (this.$refs.pricechart as any) as ApexCharts;
        pricechart && pricechart.updateSeries(this.priceseries);
        const chargechart = (this.$refs.chargechart as any) as ApexCharts;
        chargechart && chargechart.updateSeries(this.chargeseries);
        this.fullUpdate = false;
      }
      this.annotate(); // Move the timeline
    }, 60e3);
  }
  beforeDestroy() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  @Watch("vehicle", { deep: true })
  onVehicleUpdate() {
    log(LogLevel.Trace, `onVehicleUpdate triggered`);
    this.$apollo.queries.chartData.refresh();
  }

  @Watch("chartData")
  onChartDataChange() {
    log(LogLevel.Trace, `onChartDataChange triggered`);
    this.fullUpdate = true;
  }

  priceAnnotations: any[] = [];
  chargeAnnotations: any[] = [];
  annotate() {
    if (
      !this.chartReady ||
      !this.chartData ||
      !this.chartData.prices ||
      this.chartData.prices.length < 2
    ) {
      return;
    }
    const pricechart = (this.$refs.pricechart as any) as ApexCharts;
    const chargechart = (this.$refs.chargechart as any) as ApexCharts;

    const thisHour = Math.trunc(Date.now() / (60 * 60e3)) * (60 * 60e3);
    const thisPrice = this.chartData!.prices.find(
      f => new Date(f.startAt).getTime() === thisHour
    );
    if (thisPrice) {
      if (pricechart) {
        (pricechart as any).clearAnnotations();
        for (const a of this.priceAnnotations) {
          pricechart.addXaxisAnnotation(a);
        }

        // Annotate current price
        pricechart.addPointAnnotation({
          x: Date.now(),
          y: scalePrice(thisPrice.price),
          yAxisIndex: 0,
          seriesIndex: 0,
          marker: {
            size: 3,
            fillColor: "none",
            strokeColor: "#ff0000aa",
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
              background: "#fff",
              color: "#ff0000aa",
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

        // Annotate current time
        pricechart.addXaxisAnnotation({
          x: Date.now(),
          strokeDashArray: 0,
          borderColor: "#ff0000aa",
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
              color: "#ff0000aa",
              fontSize: "12px",
              cssClass: "apexcharts-xaxis-annotation-label"
            }
          }
        });
        // Annotate threshold price
        pricechart.addYaxisAnnotation({
          y: scalePrice(this.chartData.thresholdPrice),
          strokeDashArray: [2, 5],
          fillColor: "none",
          borderColor: "#2E93fA",
          borderWidth: 2,
          opacity: 0.2,
          offsetX: 0,
          offsetY: 0,
          label: {
            borderWidth: 0,
            text: scalePrice(this.chartData.thresholdPrice).toString(),
            textAnchor: "end",
            position: "left",
            offsetX: -2,
            offsetY: 7,
            style: {
              background: "none",
              color: "#558ec7",
              fontSize: "12px",
              cssClass: "apexcharts-xaxis-annotation-label"
            }
          }
        });
      }
      if (chargechart) {
        (chargechart as any).clearAnnotations();
        for (const a of this.chargeAnnotations) {
          chargechart.addXaxisAnnotation(a);
        }

        // Annotate current time
        chargechart.addXaxisAnnotation({
          x: Date.now(),
          strokeDashArray: 0,
          borderColor: "#ff0000aa",
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
              color: "#ff0000aa",
              fontSize: "12px",
              cssClass: "apexcharts-xaxis-annotation-label"
            }
          }
        });

        // Annotate emergency level zone
        if (this.minLevel && this.minLevel < this.chartData.minimumLevel) {
          chargechart.addYaxisAnnotation({
            y: this.minLevel,
            y2: this.chartData.minimumLevel,
            strokeDashArray: 0,
            fillColor: "#ffaa00",
            borderColor: "none",
            borderWidth: 0,
            opacity: 0.1,
            offsetX: 0,
            offsetY: 0,
            label: {
              borderWidth: 0,
              text: this.chartData.minimumLevel.toString(),
              style: {
                background: "none",
                color: "none"
              }
            }
          });
        }
      }
    }
  }

  get priceseries() {
    log(LogLevel.Trace, `priceseries()`);
    let data: any = [];
    if (this.chartData && this.chartData.prices.length > 1) {
      data = this.chartData!.prices.map(p => [
        new Date(p.startAt).getTime(),
        scalePrice(p.price)
      ]);
    }
    if (data.length) {
      this.minPrice = Number.POSITIVE_INFINITY;
      this.maxPrice = Number.NEGATIVE_INFINITY;
      for (const p of data) {
        if (p[1] !== null && p[1] < this.minPrice!) this.minPrice = p[1];
        if (p[1] !== null && p[1] > this.maxPrice!) this.maxPrice = p[1];
      }
      this.minPrice = Math.round(this.minPrice * 0.95);
      this.maxPrice = Math.round(this.maxPrice * 1.05);
    } else {
      this.minPrice = 0;
      this.maxPrice = 1;
    }
    return [{ name: "price", data }];
  }

  get chargeseries() {
    log(LogLevel.Trace, `chargeseries()`);
    let data: any = [];
    if (this.chartData && this.chartData.prices.length > 1) {
      let level = this.chartData.batteryLevel;
      const chartStart = new Date(this.chartData.prices[0].startAt).getTime();
      const chartEnd = new Date(
        this.chartData.prices[this.chartData.prices.length - 1].startAt
      ).getTime();
      data.push([chartStart, null]);
      data.push([new Date().getTime(), level]);
      this.priceAnnotations = [];
      this.chargeAnnotations = [];
      // Simulate charging
      if (this.chartData.chargePlan) {
        for (const c of this.chartData.chargePlan) {
          let timeNeeded = (c.level - level) * this.chartData.levelChargeTime;
          let cs = Date.now();
          if (c.chargeStart) {
            cs = Math.max(cs, new Date(c.chargeStart).getTime());
          }
          let ce = cs + timeNeeded * 1e3;

          if (
            c.chargeStop &&
            ce - new Date(c.chargeStop).getTime() >
              this.chartData.levelChargeTime * 1e3
          ) {
            ce = new Date(c.chargeStop).getTime();
          }
          ce = Math.min(ce, chartEnd);

          if (ce < cs) continue;

          if (data.length < 1 || cs > data[data.length - 1][0])
            data.push([cs, level]);
          level = Math.min(
            c.level,
            level + Math.round((ce - cs) / 1e3 / this.chartData.levelChargeTime)
          );
          data.push([ce, level]);

          // Add chart annotations
          const from = Math.max(
            chartStart,
            c.chargeStart ? new Date(c.chargeStart).getTime() : Date.now()
          );
          const to = Math.min(
            chartEnd,
            c.chargeStop ? new Date(c.chargeStop).getTime() : ce
          );
          if (to > from) {
            this.priceAnnotations.push({
              x: from,
              x2: to,
              strokeDashArray: 0,
              fillColor:
                c.chargeType === ChargeType.fill ||
                c.chargeType === ChargeType.prefered
                  ? "#2ec2fa"
                  : "#2e93fa",
              borderColor: "none",
              borderWidth: 0,
              opacity: 0.2,
              offsetX: 0,
              offsetY: 0,
              label: {
                borderWidth: 0,
                offsetX: 3,
                text: c.comment,
                style: {
                  background: "none",
                  color: "#507faf"
                }
              }
            });
            this.chargeAnnotations.push({
              x: from,
              x2: to,
              strokeDashArray: 0,
              fillColor:
                c.chargeType === ChargeType.fill ||
                c.chargeType === ChargeType.prefered
                  ? "#2ec2fa"
                  : "#2e93fa",
              borderColor: "none",
              borderWidth: 0,
              opacity: 0.2,
              offsetX: 0,
              offsetY: 0,
              label: {
                borderWidth: 0,
                text: c.chargeType,
                style: {
                  background: "none",
                  color: "none"
                }
              }
            });
          }
        }
      }
      data.push([chartEnd, level]);
    }
    if (data.length) {
      this.minLevel = Number.POSITIVE_INFINITY;
      this.maxLevel = Number.NEGATIVE_INFINITY;
      for (const p of data) {
        if (p[1] !== null && p[1] < this.minLevel!) this.minLevel = p[1];
        if (p[1] !== null && p[1] > this.maxLevel!) this.maxLevel = p[1];
      }
      this.minLevel = Math.min(
        100,
        Math.max(0, Math.floor((this.minLevel - 5) / 10) * 10)
      );
      this.maxLevel = Math.min(
        100,
        Math.max(0, Math.ceil((this.maxLevel + 5) / 10) * 10)
      );
    } else {
      this.minLevel = 0;
      this.maxLevel = 100;
    }
    return [{ name: "level", data }];
  }

  get priceoptions() {
    return deepmerge(defaultOptions, {
      chart: {
        id: "price-chart",
        events: {
          updated: (_chartContext: any, _config: any) => {
            if (this.chartData) {
              this.chartReady = true;
              this.annotate();
            }
          }
        }
      },
      stroke: {
        curve: "stepline"
      },
      colors: ["#308c30"],
      yaxis: [
        {
          tickAmount: 6,
          min: this.chartData ? this.minPrice : undefined,
          max: this.chartData ? this.maxPrice : undefined
        }
      ],
      tooltip: {
        y: {
          formatter: (
            value: any,
            { _series, _seriesIndex, _dataPointIndex }: any
          ) => {
            return value + " öre";
          }
        }
      },
      subtitle: {
        text: `Price per kw/h${
          this.chartData
            ? " when charging at " + this.chartData.locationName
            : ""
        }`,
        align: "left",
        margin: 10,
        offsetX: 0,
        offsetY: 0,
        floating: false,
        style: {
          fontSize: "14px",
          color: "#9699a2"
        }
      }
    });
  }

  get chargeoptions() {
    return deepmerge(defaultOptions, {
      chart: {
        id: "price-chart"
      },
      stroke: {
        curve: "straight"
      },
      colors: ["#2E93fA"],
      yaxis: [
        {
          tickAmount: 4,
          min: this.chartData ? this.minLevel : undefined,
          max: this.chartData ? this.maxLevel : undefined
        }
      ],
      tooltip: {
        y: {
          formatter: (
            value: any,
            { _series, _seriesIndex, _dataPointIndex }: any
          ) => {
            return value + "%";
          },
          title: {
            formatter: (
              _seriesName: any,
              { series, seriesIndex, dataPointIndex }: any
            ) => {
              if (
                series[seriesIndex][dataPointIndex] === series[seriesIndex][0]
              ) {
                return "Level";
              } else {
                return "Est. level";
              }
            }
          }
        }
      },
      markers: {
        size: 4
      },
      subtitle: {
        text: "Estimated level if connected to charger",
        align: "left",
        margin: 10,
        offsetX: 0,
        offsetY: 0,
        floating: false,
        style: {
          fontSize: "14px",
          color: "#9699a2"
        }
      }
    });
  }
}
</script>

<style></style>
