<template>
  <div>
    <apex
      ref="pricechart"
      class="chart"
      height="400"
      :options="priceoptions"
      :series="priceseries"
    ></apex>
    <apex
      ref="chargechart"
      class="chart"
      height="200"
      :options="chargeoptions"
      :series="chargeseries"
    ></apex>
  </div>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import { ChartData } from "@shared/gql-types";
import VueApexCharts from "vue-apexcharts";
import { gql } from "apollo-boost";
import deepmerge from "deepmerge";
import { log, LogLevel } from "../../../shared/utils";

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
          vehicleID: this.vehicle,
          locationID: this.location
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
  @Prop(String) readonly vehicle!: string;
  @Prop(String) readonly location!: string;
  chartData?: ChartData;
  timer?: any;
  chartReady: boolean = false;
  minPrice?: number;
  maxPrice?: number;
  minLevel?: number;
  maxLevel?: number;
  fullUpdate!: boolean;

  data() {
    return {
      chartData: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      minLevel: undefined,
      maxLevel: undefined,
      fullUpdate: false
    };
  }
  mounted() {}
  created() {
    this.timer = setInterval(() => {
      log(LogLevel.Trace, `timer tick fullUpdate=${this.fullUpdate}`);
      if (this.fullUpdate) {
        const pricechart = (this.$refs.pricechart as any) as ApexCharts;
        pricechart.updateSeries(this.priceseries);
        const chargechart = (this.$refs.chargechart as any) as ApexCharts;
        chargechart.updateSeries(this.chargeseries);
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

  @Watch("chartData")
  onChartDataChange() {
    log(LogLevel.Trace, `onChartDataChange triggered`);
    this.fullUpdate = true;
  }

  annotate() {
    const pricechart = (this.$refs.pricechart as any) as ApexCharts;
    const chargechart = (this.$refs.chargechart as any) as ApexCharts;
    if (this.chartReady && pricechart && this.chartData) {
      const thisHour = Math.trunc(Date.now() / (60 * 60e3)) * (60 * 60e3);
      const thisPrice = this.chartData!.prices.find(
        f => new Date(f.startAt).getTime() === thisHour
      );
      if (thisPrice) {
        (pricechart as any).clearAnnotations();
        (chargechart as any).clearAnnotations();
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
        pricechart.addYaxisAnnotation({
          y: scalePrice(this.chartData.thresholdPrice),
          strokeDashArray: [2, 5],
          fillColor: "none",
          borderColor: "#2E93fA",
          borderWidth: 2,
          opacity: 0.1,
          offsetX: 0,
          offsetY: 0,
          label: {
            borderWidth: 0,
            text: scalePrice(this.chartData.thresholdPrice).toString(),
            textAnchor: "end",
            position: "right",
            orientation: "horizontal",
            offsetX: 0,
            offsetY: 16,
            style: {
              background: "none",
              color: "#2E93fA",
              fontSize: "12px",
              cssClass: "apexcharts-xaxis-annotation-label"
            }
          }
        });

        // Charge fields
        if (this.chartData.chargePlan) {
          const chartStart = new Date(
            this.chartData.prices[0].startAt
          ).getTime();
          const chartEnd = new Date(
            this.chartData.prices[this.chartData.prices.length - 1].startAt
          ).getTime();

          for (const p of this.chartData.chargePlan) {
            if (!p.chargeStop) {
              continue;
            }
            const to = Math.min(chartEnd, new Date(p.chargeStop).getTime());
            if (to < Date.now()) {
              continue;
            }
            const from = Math.max(
              chartStart,
              p.chargeStart ? new Date(p.chargeStart).getTime() : Date.now()
            );

            if (to > from) {
              pricechart.addXaxisAnnotation({
                x: from,
                x2: to,
                strokeDashArray: 0,
                fillColor: "#2E93fA",
                borderWidth: 0,
                opacity: 0.1,
                offsetX: 0,
                offsetY: 0,
                label: {
                  borderWidth: 0,
                  text: p.comment,
                  style: {
                    background: "none",
                    color: "#2E93fA"
                  }
                }
              });
              chargechart.addXaxisAnnotation({
                x: from,
                x2: to,
                strokeDashArray: 0,
                fillColor: "#2E93fA",
                borderWidth: 0,
                opacity: 0.1,
                offsetX: 0,
                offsetY: 0,
                label: {
                  borderWidth: 0,
                  text: p.chargeType,
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
    }
  }

  get priceseries() {
    log(LogLevel.Trace, `priceseries()`);
    let data: any = [];
    if (this.chartData) {
      data = this.chartData!.prices.map(p => [
        new Date(p.startAt).getTime(),
        scalePrice(p.price)
      ]);
    }
    if (data.length) {
      this.minPrice = Number.POSITIVE_INFINITY;
      this.maxPrice = Number.NEGATIVE_INFINITY;
      for (const p of data) {
        if (p[1] < this.minPrice!) this.minPrice = p[1];
        if (p[1] > this.maxPrice!) this.maxPrice = p[1];
      }
      this.minPrice = Math.round(this.minPrice! * 0.95);
      this.maxPrice = Math.round(this.maxPrice! * 1.05);
    } else {
      this.minPrice = undefined;
      this.maxPrice = undefined;
    }
    return [{ name: "price", data }];
  }

  get chargeseries() {
    log(LogLevel.Trace, `chargeseries()`);
    let data: any = [];
    if (this.chartData) {
      let level = this.chartData.batteryLevel;
      const chartStart = new Date(this.chartData.prices[0].startAt).getTime();
      const chartEnd = new Date(
        this.chartData.prices[this.chartData.prices.length - 1].startAt
      ).getTime();
      data.push([chartStart, level]);
      // Simulate charging
      if (this.chartData.chargePlan) {
        for (const c of this.chartData.chargePlan) {
          let timeNeeded = (c.level - level) * this.chartData.levelChargeTime;
          let cs = Date.now();
          if (c.chargeStart) {
            cs = Math.max(cs, new Date(c.chargeStart).getTime());
          }
          let ce = Math.min(cs + timeNeeded * 1e3, chartEnd);
          if (c.chargeStop) {
            ce = Math.min(ce, new Date(c.chargeStop).getTime());
          }
          if (ce < cs) continue;

          if (cs > data[data.length - 1][0]) data.push([cs, level]);
          level += Math.round((ce - cs) / 1e3 / this.chartData.levelChargeTime);
          data.push([ce, level]);
        }
      }
      data.push([chartEnd, level]);
    }
    if (data.length) {
      this.minLevel = Number.POSITIVE_INFINITY;
      this.maxLevel = Number.NEGATIVE_INFINITY;
      for (const p of data) {
        if (p[1] < this.minLevel!) this.minLevel = p[1];
        if (p[1] > this.maxLevel!) this.maxLevel = p[1];
      }
      this.minLevel = Math.round(this.minLevel! * 0.95);
      this.maxLevel = Math.round(this.maxLevel! * 1.05);
    } else {
      this.minLevel = undefined;
      this.maxLevel = undefined;
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
      colors: ["#33aa33"],
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
