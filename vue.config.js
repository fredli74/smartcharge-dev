const path = require("path");
const webpack = require("webpack");

module.exports = {
  outputDir: path.resolve(__dirname, "./dist/app"),
  devServer: {
    contentBase: [
      path.join(__dirname, "app/public"),
      path.join(__dirname, "public")
    ]
  },
  chainWebpack: config => {
    config
      .entry("app")
      .clear()
      .add("./app/src/main.ts")
      .end();

    config.resolve.alias.delete("@");
    config.resolve.alias.set("@app", path.resolve("./app/src"));
    config.resolve.alias.set("@shared", path.resolve("./shared"));
    config.resolve.alias.set("@providers", path.resolve("./providers"));
    config.resolve.alias.set("@server", path.resolve("./server"));

    config.plugin("type-graphql").use(webpack.NormalModuleReplacementPlugin, [
      /type-graphql$/,
      resource => {
        resource.request = resource.request.replace(
          /type-graphql/,
          "type-graphql/dist/browser-shim"
        );
      }
    ]);
  }
};
