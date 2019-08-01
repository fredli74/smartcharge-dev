module.exports = {
  sourceMaps:"inline",
  presets: ["@babel/env", "@babel/preset-typescript"],
  plugins: [
    "babel-plugin-transform-typescript-metadata",
    ["@babel/proposal-decorators", { legacy: true }],
    ["@babel/proposal-class-properties", { loose: true }],
    "@babel/proposal-object-rest-spread",
    "@babel/plugin-transform-runtime",
    [
      "module-resolver",
      {
        root: ["."],
        alias: {
          "@app": "./app/src",
          "@shared": "./shared",
          "@server": "./server",
          "@providers": "./providers"
        }
      }
    ]
  ]
};
