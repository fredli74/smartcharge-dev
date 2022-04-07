const path = require("path");
const webpack = require("webpack");
const CopyPlugin = require("copy-webpack-plugin");
const globals = require("./shared/smartcharge-globals.json");

let commitHash =
  process.env.SOURCE_VERSION ||
  require("child_process")
    .execSync("git rev-parse --short HEAD")
    .toString()
    .trim();

module.exports = {
  outputDir: path.resolve(__dirname, "./dist/app"),
  pages: {
    index: {
      entry: "app/src/main.ts",
      template: "app/public/index.html",
      filename: "index.html",
    },
  },
  devServer: {
    proxy: {
      [globals.API_PATH]: {
        //"https://smartcharge-dev.herokuapp.com",
        target: `http://localhost:${
          process.env.SERVER_PORT || globals.DEFAULT_PORT
        }`,
        ws: true,
      },
    },
    contentBase: [
      path.resolve(__dirname, "app/public"),
      path.resolve(__dirname, "public"),
    ],
  },
  configureWebpack: {
    plugins: [
      new webpack.DefinePlugin({
        COMMIT_HASH: JSON.stringify(commitHash),
      }),
      new CopyPlugin([
        {
          from: path.resolve(__dirname, "./app/public/"),
          to: ".",
          ignore: ["index.html", ".DS_Store"],
        },
      ]),
    ],
  },
  chainWebpack: (config) => {
    config.entry("app").clear().add("./app/src/main.ts").end();

    // Not needed anymore?
    //config.resolve.alias.delete("@");
    //config.resolve.alias.set("@app", path.resolve("./app/src"));
    //config.resolve.alias.set("@shared", path.resolve("./shared"));
    //config.resolve.alias.set("@providers", path.resolve("./providers"));
    //config.resolve.alias.set("@server", path.resolve("./server"));

    // Remove warnings regaring files that are omitted by TS because they only contain interfaces
    config
      .plugin("IgnoreNotFoundExportPlugin")
      .before("friendly-errors")
      .use(IgnoreNotFoundExportPlugin, [
        {
          sourceFiles: [/\/shared\/sc-schema$/],
        },
      ]);

    config.plugin("type-graphql").use(webpack.NormalModuleReplacementPlugin, [
      /type-graphql$/,
      (resource) => {
        resource.request = resource.request.replace(
          /type-graphql/,
          "type-graphql/dist/browser-shim"
        );
      },
    ]);
  },
  pwa: {
    workboxOptions: {
      skipWaiting: true,
    },
  },
};

/***
 *
 * INLINE IgnoreNotFoundExportPlugin from https://github.com/TypeStrong/ts-loader/issues/653#issuecomment-467403243
 * Thanks to https://github.com/iyinchao
 *
 * ***/
const ModuleDependencyWarning = require("webpack/lib/ModuleDependencyWarning");
class IgnoreNotFoundExportPlugin {
  constructor(option) {
    const op = {
      sourceFiles: [],
      exportNames: [],
      ...option,
    };
    this.ignoredSourceFiles = op.sourceFiles;
    this.ignoredExportNames = op.exportNames;
  }

  apply(compiler) {
    const reg = /export '(.*)'.* was not found in '(.*)'/;
    const doneHook = (stats) => {
      stats.compilation.warnings = stats.compilation.warnings.filter((warn) => {
        if (!(warn instanceof ModuleDependencyWarning) || !warn.message) {
          return true;
        }

        const matchedResult = warn.message.match(reg);

        if (!matchedResult) {
          return true;
        }

        const [, exportName, sourceFile] = matchedResult;

        const customRulesIgnore = {
          exportNames: false,
          sourceFiles: false,
        };

        if (this.ignoredExportNames.length) {
          for (let i = 0; i < this.ignoredExportNames.length; i++) {
            const rule = this.ignoredExportNames[i];
            if (typeof rule === "string" && rule === exportName) {
              customRulesIgnore.exportNames = true;
              break;
            } else if (rule instanceof RegExp && rule.test(exportName)) {
              customRulesIgnore.exportNames = true;
              break;
            }
          }
        } else {
          customRulesIgnore.exportNames = true;
        }

        if (this.ignoredSourceFiles.length) {
          for (let i = 0; i < this.ignoredSourceFiles.length; i++) {
            const rule = this.ignoredSourceFiles[i];
            if (typeof rule === "string" && rule === sourceFile) {
              customRulesIgnore.sourceFiles = true;
              break;
            } else if (rule instanceof RegExp && rule.test(sourceFile)) {
              customRulesIgnore.sourceFiles = true;
              break;
            }
          }
        } else {
          customRulesIgnore.sourceFiles = true;
        }

        let ret = false;
        Object.keys(customRulesIgnore).forEach((key) => {
          if (!customRulesIgnore[key]) {
            ret = true;
          }
        });

        return ret;
      });
    };

    if (compiler.hooks) {
      compiler.hooks.done.tap("IgnoreNotFoundExportPlugin", doneHook);
    } else {
      compiler.plugin("done", doneHook);
    }
  }
}
