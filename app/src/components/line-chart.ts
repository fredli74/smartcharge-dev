import { Line, mixins } from "vue-chartjs";
import { Component, Mixins } from "vue-property-decorator";
import { ChartData, ChartOptions } from "chart.js";

//import { ReactiveDataMixin, ReactivePropMixin } from "vue-chartjs/types/mixins";

// crosshair partly stolen from https://github.com/AbelHeinsbroek/chartjs-plugin-crosshair
// but it was not maintained so I just quick and dirty pasted it together here
const crosshair = {
  id: "crosshair",
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
  afterDraw: function (chart: any) {
    chart.ctx.save();

    const isSnapping = chart.options.plugins.crosshair.snapping;
    const isHoverIntersectOff = chart.config.options.hover.intersect === false;

    // drawTraceLine
    const meta = chart.getDatasetMeta(0);
    const yScale = chart.scales[meta.yAxisID];

    if (this.insideChart(chart, chart.crosshair.x, chart.crosshair.y)) {
      let lineX = chart.crosshair.x;

      if (isSnapping && isHoverIntersectOff && chart.active.length) {
        lineX = chart.active[0]._view.x;
      }
      console.log(chart.active);
      chart.ctx.setLineDash([4, 4]);

      chart.ctx.beginPath();
      chart.ctx.moveTo(lineX, yScale.getPixelForValue(yScale.max));
      chart.ctx.lineWidth = chart.options.plugins.crosshair.line.width;
      chart.ctx.strokeStyle = chart.options.plugins.crosshair.line.color;
      chart.ctx.lineTo(lineX, yScale.getPixelForValue(yScale.min));

      chart.ctx.setLineDash(chart.options.plugins.crosshair.line.dashPattern);
      chart.ctx.stroke();
      chart.ctx.setLineDash([]);
    }

    if (!isSnapping) {
      // interpolateValues
      for (
        let chartIndex = 0;
        chartIndex < chart.data.datasets.length;
        chartIndex++
      ) {
        const dataset = chart.data.datasets[chartIndex];
        const meta = chart.getDatasetMeta(chartIndex);
        if (meta.hidden || !dataset.interpolate) {
          continue;
        }

        const xScale = chart.scales[meta.xAxisID];
        const yScale = chart.scales[meta.yAxisID];
        const xValue = xScale.getValueForPixel(chart.crosshair.x);

        const data = dataset.data;
        const index = data.findIndex(function (o: any) {
          return o.x >= xValue;
        });
        const prev = data[index - 1];
        const next = data[index];

        let interpolatedValue = NaN;
        if (chart.data.datasets[chartIndex].steppedLine && prev) {
          interpolatedValue = prev.y;
        } else if (prev && next) {
          const slope = (next.y - prev.y) / (next.x - prev.x);
          interpolatedValue = prev.y + (xValue - prev.x) * slope;
        }

        chart.ctx.beginPath();
        chart.ctx.arc(
          chart.crosshair.x,
          yScale.getPixelForValue(interpolatedValue),
          3,
          0,
          2 * Math.PI,
          false
        );
        chart.ctx.fillStyle = "white";
        chart.ctx.lineWidth = 2;
        chart.ctx.strokeStyle = dataset.borderColor;
        chart.ctx.fill();
        chart.ctx.stroke();
      }
    }

    chart.ctx.restore();
    return true;
  }
};

@Component({
  extends: Line,
  props: ["chartData", "options"],
  mixins: [mixins.reactiveProp]
})
export default class LineChart extends Mixins(Line) {
  chartData?: ChartData;
  options?: ChartOptions;
  mounted() {
    this.addPlugin(crosshair);
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
    y: chart.chartArea.top
  };
};
