module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:vue/recommended",
    "@vue/typescript",
  ],
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        vars: "all",
        args: "after-used",
        argsIgnorePattern: "^_",
        ignoreRestSiblings: false,
      },
    ],
    "indent": ["warn", 2, { "SwitchCase": 1, "flatTernaryExpressions": true }],
    "no-console": process.env.NODE_ENV === "// production" ? "warn" : "off",
    "no-debugger": process.env.NODE_ENV === "production" ? "error" : "off",
    "vue/max-attributes-per-line": "off",
    "vue/html-indent": ["warn", 2, { "alignAttributesVertically": false }],
    "vue/singleline-html-element-content-newline": "off",
    "vue/multi-word-component-names": "off",
  },
  parserOptions: {
    parser: "@typescript-eslint/parser",
  },
};
