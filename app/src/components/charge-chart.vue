<template>
  <div>
    <apex class="chart" type="line" :options="options" :series="series"></apex>
    {{ chartData }}
  </div>
</template>

<script lang="ts">
import { Component, Vue, Prop, Watch } from "vue-property-decorator";
import { Vehicle, ChartData } from "@shared/gql-types";
import providers from "@providers/provider-apps";
import VueApexCharts from "vue-apexcharts";
import { gql } from "apollo-boost";

@Component({
  components: { apex: VueApexCharts },
  apollo: {
    chartData: {
      query: gql`
        query ChartData($vehicleID: String!, $locationID: String!) {
          chartData(locationID: $locationID, vehicleID: $vehicleID) {
            locationID
            vehicleID
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
      fetchPolicy: "network-only"
    }
  }
})
export default class ChargeChart extends Vue {
  @Prop(String) readonly vehicle!: string;
  @Prop(String) readonly location!: string;
  chartData?: ChartData;

  data() {
    return {
      chartData: undefined,
      options: {
        chart: {
          animations: { enabled: false },
          id: "vuechart-example",
          toolbar: {
            show: false
          }
        },
        stroke: {
          width: 2,
          curve: "straight"
        },
        title: {
          text: "Social Media",
          align: "center",
          style: {
            fontSize: "16px",
            color: "#666"
          }
        },
        fill: {
          type: "gradient",
          gradient: {
            type: "vertical",
            colorStops: [
              [
                {
                  offset: 0,
                  color: "#f00"
                },
                {
                  offset: 20,
                  color: "#ee0"
                },
                {
                  offset: 30,
                  color: "#0e0"
                }
              ]
            ]
          }
        },
        xaxis: { type: "datetime" }
      }
    };
  }
  mounted() {
    console.debug(this.vehicle);
    console.debug(this.location);
  }
  get series() {
    if (this.chartData) {
      console.debug([
        {
          name: "price",
          data: this.chartData!.prices.map(f => [f.startAt, f.price / 1e5])
        }
      ]);
      return [
        {
          name: "price",
          data: this.chartData!.prices.map(f => [
            f.startAt,
            Math.round(f.price / 1e2) / 10
          ])
        }
      ];
    }
    return [];
  }
}
</script>

<style>
.chart {
  overflow: hidden;
}
</style>
