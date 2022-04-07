import Vue from "vue";
export default new Vue();

export enum BusEvent {
  AuthenticationChange = "AUTHENTICATION_CHANGED",
  AlertClear = "ALERT_CLEAR",
  AlertWarning = "ALERT_WARNING",
  AlertError = "ALERT_ERROR",
}
