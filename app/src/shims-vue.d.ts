declare module "*.vue" {
  import Vue from "vue";
  export default Vue;
}

declare module "vue-ctk-date-time-picker" {
  var ignoreTyping: any;
  export = ignoreTyping;
}

declare module "vue-visible";
