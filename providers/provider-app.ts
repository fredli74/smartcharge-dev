/**
 * @file Provider app definitions for smartcharge.dev project
 * @author Fredrik Lidström
 * @copyright 2025 Fredrik Lidström
 * @license MIT (MIT)
 */
import { IProvider } from "./index.js";
import { VueConstructor } from "vue";
import { Vue } from "vue-property-decorator";

export type ProviderVuePage = "new" | "auth" | "config" | "view";

export interface IProviderApp extends IProvider {
  logo: any;
  image?: any;
  vue: VueConstructor<Vue>;
}
