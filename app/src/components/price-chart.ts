import { Line, mixins } from "vue-chartjs";
import { Component, Mixins } from "vue-property-decorator";
import { ChartData, ChartOptions } from "chart.js";

@Component({
  extends: Line,
  props: ["chartData", "options"],
  mixins: [mixins.reactiveProp],
})
export default class PriceChart extends Mixins(Line) {
  chartData?: ChartData;
  options?: ChartOptions;
  mounted() {
    this.addPlugin({
      id: "priceChartPlugin",
      afterInit: function (chart: any) {
        // Default options
        chart.options.plugins.crosshair = chart.options.plugins.crosshair || {};
        chart.options.plugins.crosshair.snapping =
          chart.options.plugins.crosshair.snapping || true;
        chart.options.plugins.crosshair.line =
          chart.options.plugins.crosshair.line || {};
        chart.options.plugins.crosshair.line.color =
          chart.options.plugins.crosshair.line.color || "#F66";
        chart.options.plugins.crosshair.line.width =
          chart.options.plugins.crosshair.line.width || 1;
        chart.options.plugins.crosshair.line.dashPattern = chart.options.plugins
          .crosshair.line.dashPattern || [2, 2];

        chart.crosshair = { x: null, y: null, inside: false };
      },
      afterEvent: function (chart: any, e: any) {
        chart.crosshair.x = e.x;
        chart.crosshair.y = e.y;
        chart.draw();
      },
      insideChart: function (chart: any, x?: number, y?: number) {
        return (
          (y === undefined ||
            (y >= chart.chartArea.top && y <= chart.chartArea.bottom)) &&
          (x === undefined ||
            (x >= chart.chartArea.left && x <= chart.chartArea.right))
        );
      },
    });
    if (this.chartData && this.options) {
      this.renderChart(this.chartData, this.options);
    }
  }
}

declare const Chart: any;

Chart.Tooltip.positioners.topcorner = function (
  elements: any,
  _eventPosition: any
) {
  const element = elements[0];
  const chart = element._chart;

  /** @type {Chart.Tooltip} */
  //var tooltip = this;

  /* ... */

  return {
    x: chart.chartArea.left,
    y: chart.chartArea.top,
  };
};
