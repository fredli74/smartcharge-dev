const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");
const globals = require("./shared/smartcharge-globals.json");

let commitHash = require("child_process")
  .execSync("git rev-parse --short HEAD")
  .toString()
  .trim();

module.exports = {
  outputDir: path.resolve(__dirname, "./dist/app"),
  pages: {
    index: {
      entry: "app/src/main.ts",
      template: "app/public/index.html",
      filename: "index.html"
    }
  },
  devServer: {
    proxy: {
      [globals.API_PATH]: {
        target: `http://localhost:${process.env.SERVER_PORT ||
          globals.DEFAULT_PORT}`,
        ws: true
      }
    },
    contentBase: [
      path.resolve(__dirname, "app/public"),
      path.resolve(__dirname, "public")
    ]
  },
  configureWebpack: {
    plugins: [
      new webpack.DefinePlugin({
        COMMIT_HASH: JSON.stringify(commitHash)
      }),
      new CopyPlugin([
        {
          from: path.resolve(__dirname, "./app/public/"),
          to: ".",
          ignore: ["index.html", ".DS_Store"]
        }
      ])
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
  },
  pwa: {
    workboxOptions: {
      skipWaiting: true
    }
  }
};
