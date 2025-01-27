module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:vue/recommended",
    "@vue/typescript/recommended",
  ],
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-explicit-any": "off",
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
    "no-console": "off",
    "no-debugger": "warn",
    "vue/max-attributes-per-line": "off",
    "vue/html-indent": ["warn", 2, { "alignAttributesVertically": false }],
    "vue/singleline-html-element-content-newline": "off",
    "vue/multi-word-component-names": "off",
    "vue/html-self-closing": ["warn", { html: { void: "always", normal: "never" } }],
  },
  parserOptions: {
    parser: "@typescript-eslint/parser",
  },
};
